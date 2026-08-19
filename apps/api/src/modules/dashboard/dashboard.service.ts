import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(organizationId: string, days: number) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const scope = { organizationId, createdAt: { gte: since } };

    const [
      totalInspections,
      windowInspections,
      byStatus,
      aggregates,
      deviceCount,
      recent,
      topFindings,
      partBreakdown,
    ] = await Promise.all([
      this.prisma.inspection.count({ where: { organizationId } }),
      this.prisma.inspection.count({ where: scope }),
      this.prisma.inspection.groupBy({
        by: ['verificationStatus'],
        where: scope,
        _count: { _all: true },
      }),
      this.prisma.inspection.aggregate({
        where: scope,
        _avg: { trustScore: true, batteryScore: true, softwareScore: true, partsScore: true, confidence: true },
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
          verificationStatus: true,
          device: { select: { marketingName: true, capacityGb: true } },
          user: { select: { name: true } },
        },
      }),
      this.prisma.findingRecord.groupBy({
        by: ['code', 'severity'],
        where: { inspection: scope },
        _count: { _all: true },
        orderBy: { _count: { code: 'desc' } },
        take: 8,
      }),
      // What a refurbisher actually wants to know: which components are coming
      // back non-genuine, and how often.
      this.prisma.partResultRecord.groupBy({
        by: ['component', 'verdict'],
        where: { inspection: scope },
        _count: { _all: true },
      }),
    ]);

    const statusCounts = Object.fromEntries(
      byStatus.map((row) => [row.verificationStatus, row._count._all]),
    );

    const flagged = (statusCounts['FLAGGED'] ?? 0) + (statusCounts['CAUTION'] ?? 0);
    const verified = (statusCounts['VERIFIED'] ?? 0) + (statusCounts['VERIFIED_WITH_NOTES'] ?? 0);

    return {
      windowDays: days,
      totals: {
        inspections: totalInspections,
        inspectionsInWindow: windowInspections,
        devices: deviceCount,
        verified,
        flagged,
        inconclusive: statusCounts['INCONCLUSIVE'] ?? 0,
      },
      averages: {
        trustScore: round(aggregates._avg.trustScore),
        batteryScore: round(aggregates._avg.batteryScore),
        softwareScore: round(aggregates._avg.softwareScore),
        partsScore: round(aggregates._avg.partsScore),
        confidence: aggregates._avg.confidence ? Number(aggregates._avg.confidence.toFixed(3)) : null,
      },
      statusBreakdown: statusCounts,
      partBreakdown: partBreakdown
        .filter((row) => row.verdict !== 'CANNOT_DETERMINE')
        .map((row) => ({ component: row.component, verdict: row.verdict, count: row._count._all })),
      topFindings: topFindings.map((row) => ({
        code: row.code,
        severity: row.severity,
        count: row._count._all,
      })),
      recent,
    };
  }
}

const round = (value: number | null | undefined): number | null =>
  value === null || value === undefined ? null : Math.round(value);
