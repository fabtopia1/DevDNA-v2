import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fleet view.
   *
   * Every aggregate here is plain indexed SQL over denormalised columns, which
   * is why evidence, component outcomes and findings are stored as rows rather
   * than only inside the report JSON. "How many third-party displays did we see
   * this month" and "which collection channel keeps failing" are the questions
   * a refurbisher actually asks, and neither should need a JSON traversal.
   */
  async summary(organizationId: string, days: number) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const scope = { organizationId, createdAt: { gte: since } };

    const [
      totalInspections,
      windowInspections,
      byVerdict,
      aggregates,
      deviceCount,
      recent,
      topFindings,
      componentOutcomes,
      moduleAbstentions,
      failingChannels,
    ] = await Promise.all([
      this.prisma.inspection.count({ where: { organizationId } }),
      this.prisma.inspection.count({ where: scope }),
      this.prisma.inspection.groupBy({
        by: ['trustVerdict'],
        where: scope,
        _count: { _all: true },
      }),
      this.prisma.inspection.aggregate({
        where: scope,
        _avg: {
          trustScore: true,
          confidence: true,
          coverage: true,
          batteryHealthPercent: true,
          securityPostureScore: true,
        },
      }),
      this.prisma.device.count({ where: { organizationId } }),
      this.prisma.inspection.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          createdAt: true,
          trustScore: true,
          trustVerdict: true,
          confidence: true,
          componentsReplacedCount: true,
          device: { select: { marketingName: true, capacityGb: true } },
          user: { select: { name: true } },
        },
      }),
      this.prisma.findingRecord.groupBy({
        by: ['code', 'severity', 'module'],
        where: { inspection: scope },
        _count: { _all: true },
        orderBy: { _count: { code: 'desc' } },
        take: 8,
      }),
      // What the trade actually prices: which components come back replaced,
      // and whether the part fitted could be verified.
      this.prisma.componentServiceRow.groupBy({
        by: ['subject', 'verdict', 'authenticity'],
        where: { inspection: scope },
        _count: { _all: true },
      }),
      // Where the engine is blind. A rising abstention rate for one module is
      // the signal that a data source has been closed off upstream.
      this.prisma.moduleVerdictRow.groupBy({
        by: ['module', 'determinacy'],
        where: { inspection: scope },
        _count: { _all: true },
      }),
      // Which collection channels are failing across the fleet.
      this.prisma.evidenceRecordRow.groupBy({
        by: ['collector'],
        where: { inspection: scope, kind: 'COLLECTION_FAILURE' },
        _count: { _all: true },
        orderBy: { _count: { collector: 'desc' } },
        take: 6,
      }),
    ]);

    const verdictCounts = Object.fromEntries(
      byVerdict.map((row) => [row.trustVerdict, row._count._all]),
    );

    const trusted =
      (verdictCounts['TRUSTED'] ?? 0) + (verdictCounts['TRUSTED_WITH_NOTES'] ?? 0);
    const flagged = (verdictCounts['UNTRUSTED'] ?? 0) + (verdictCounts['CAUTION'] ?? 0);

    return {
      windowDays: days,
      totals: {
        inspections: totalInspections,
        inspectionsInWindow: windowInspections,
        devices: deviceCount,
        trusted,
        flagged,
        insufficientEvidence: verdictCounts['INSUFFICIENT_EVIDENCE'] ?? 0,
      },
      averages: {
        trustScore: round(aggregates._avg.trustScore),
        confidence: round3(aggregates._avg.confidence),
        coverage: round3(aggregates._avg.coverage),
        batteryHealthPercent: round(aggregates._avg.batteryHealthPercent),
        securityPostureScore: round(aggregates._avg.securityPostureScore),
      },
      verdictBreakdown: verdictCounts,
      componentOutcomes: componentOutcomes
        .filter((row) => row.verdict !== 'CANNOT_DETERMINE')
        .map((row) => ({
          component: row.subject,
          verdict: row.verdict,
          authenticity: row.authenticity,
          count: row._count._all,
        })),
      moduleCoverage: moduleAbstentions.map((row) => ({
        module: row.module,
        determinacy: row.determinacy,
        count: row._count._all,
      })),
      failingCollectors: failingChannels.map((row) => ({
        collector: row.collector,
        failures: row._count._all,
      })),
      topFindings: topFindings.map((row) => ({
        code: row.code,
        severity: row.severity,
        module: row.module,
        count: row._count._all,
      })),
      recent,
    };
  }
}

const round = (value: number | null | undefined): number | null =>
  value === null || value === undefined ? null : Math.round(value);

const round3 = (value: number | null | undefined): number | null =>
  value === null || value === undefined ? null : Number(value.toFixed(3));
