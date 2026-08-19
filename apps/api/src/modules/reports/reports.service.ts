import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { customAlphabet } from 'nanoid';
import type { InspectionReport } from '@devdna/core';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { CONFIG_TOKEN, type AppConfig } from '../../config/configuration';
import { renderReport } from './pdf-report';

/**
 * Public report ids are 12 characters from an unambiguous alphabet: long
 * enough that they cannot be enumerated, short enough to read aloud over the
 * phone between two traders, and free of characters that get confused in
 * handwriting (0/O, 1/I).
 */
const publicId = customAlphabet('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', 12);

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
  ) {}

  async generate(organizationId: string, inspectionId: string, actorId: string) {
    const inspection = await this.prisma.inspection.findFirst({
      where: { id: inspectionId, organizationId },
      include: {
        organization: { select: { name: true, logoUrl: true } },
        user: { select: { name: true } },
        bridge: { select: { workstation: true, name: true } },
        customer: { select: { name: true } },
      },
    });
    if (!inspection) throw new NotFoundException('Inspection not found');

    const id = publicId();
    const verifyUrl = `${this.config.publicVerifyBaseUrl.replace(/\/$/, '')}/${id}`;
    const inspectionReport = inspection.report as unknown as InspectionReport;

    const pdf = await renderReport(inspectionReport, {
      reportId: id,
      publicId: id,
      verifyUrl,
      organizationName: inspection.organization.name,
      technicianName: inspection.user?.name ?? null,
      workstation: inspection.bridge?.workstation ?? inspection.bridge?.name ?? null,
      customerName: inspection.customer?.name ?? null,
      generatedAt: new Date(),
    });

    const storageKey = join(
      String(new Date().getUTCFullYear()),
      String(new Date().getUTCMonth() + 1).padStart(2, '0'),
      `${id}.pdf`,
    );
    const absolutePath = this.resolveStoragePath(storageKey);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, pdf);

    const report = await this.prisma.report.create({
      data: {
        organizationId,
        inspectionId,
        publicId: id,
        storageKey,
        // Lets a recipient prove the PDF they hold is the one we issued.
        checksum: createHash('sha256').update(pdf).digest('hex'),
        sizeBytes: pdf.length,
      },
    });

    await this.audit.record({
      organizationId,
      actorType: 'USER',
      actorId,
      action: 'report.generated',
      entity: 'Report',
      entityId: report.id,
      metadata: { inspectionId, publicId: id },
    });

    return {
      id: report.id,
      publicId: id,
      verifyUrl,
      checksum: report.checksum,
      sizeBytes: report.sizeBytes,
      createdAt: report.createdAt,
    };
  }

  async download(organizationId: string, reportId: string): Promise<{ buffer: Buffer; filename: string }> {
    const report = await this.prisma.report.findFirst({
      where: { id: reportId, organizationId },
    });
    if (!report) throw new NotFoundException('Report not found');

    const buffer = await readFile(this.resolveStoragePath(report.storageKey));
    await this.prisma.report.update({
      where: { id: report.id },
      data: { downloadCount: { increment: 1 } },
    });
    return { buffer, filename: `devdna-report-${report.publicId}.pdf` };
  }

  /**
   * Public verification lookup, reached by scanning the QR code on a report.
   *
   * Deliberately minimal: it confirms the report is genuine and states the
   * verdict, but returns no serial, UDID, customer or technician detail. The
   * person scanning it is a stranger who was handed a PDF, not an authenticated
   * member of the issuing organization.
   */
  async verifyPublic(publicIdValue: string) {
    const report = await this.prisma.report.findUnique({
      where: { publicId: publicIdValue },
      include: {
        organization: { select: { name: true } },
        inspection: {
          select: {
            trustScore: true,
            rawTrustScore: true,
            trustVerdict: true,
            confidence: true,
            coverage: true,
            identityVerdict: true,
            hardwareVerdict: true,
            securityVerdict: true,
            batteryVerdict: true,
            batteryHealthPercent: true,
            batteryCycleCount: true,
            batteryWearGrade: true,
            iosVersion: true,
            unitProvenance: true,
            capturedAt: true,
            engineVersion: true,
            algorithmVersion: true,
            ledgerDigest: true,
            componentsReplacedCount: true,
            componentsIndeterminate: true,
            hardwareAnomalyCount: true,
            device: { select: { marketingName: true, capacityGb: true, regionName: true } },
            components: {
              select: { subject: true, verdict: true, authenticity: true, confidence: true },
            },
            _count: { select: { evidence: true, inferences: true } },
          },
        },
      },
    });

    if (!report || (report.expiresAt && report.expiresAt < new Date())) {
      throw new NotFoundException('No valid report exists for this code');
    }

    const inspection = report.inspection;

    return {
      valid: true,
      reportId: report.publicId,
      issuedBy: report.organization.name,
      issuedAt: report.createdAt,
      /// Lets a recipient prove the PDF they hold is the one that was issued.
      checksum: report.checksum,
      /// Lets a recipient ask the issuer to reproduce this verdict from the
      /// same evidence. Any edit to that evidence changes the digest.
      evidenceLedgerDigest: inspection.ledgerDigest,
      device: {
        model: inspection.device.marketingName,
        capacityGb: inspection.device.capacityGb,
        region: inspection.device.regionName,
        iosVersion: inspection.iosVersion,
        unitProvenance: inspection.unitProvenance,
      },
      verdict: {
        trustVerdict: inspection.trustVerdict,
        trustScore: inspection.trustScore,
        rawTrustScore: inspection.rawTrustScore,
        confidence: inspection.confidence,
        coverage: inspection.coverage,
      },
      modules: {
        identity: inspection.identityVerdict,
        hardware: inspection.hardwareVerdict,
        security: inspection.securityVerdict,
        battery: inspection.batteryVerdict,
      },
      battery: {
        healthPercent: inspection.batteryHealthPercent,
        cycleCount: inspection.batteryCycleCount,
        wearGrade: inspection.batteryWearGrade,
      },
      /// Determined components only. Components DevDNA could not assess are
      /// reported as a count, never omitted: a shorter list must not read as a
      /// cleaner device.
      components: inspection.components.filter((c) => c.verdict !== 'CANNOT_DETERMINE'),
      notAssessed: inspection.componentsIndeterminate,
      hardwareAnomalies: inspection.hardwareAnomalyCount,
      evidenceCount: inspection._count.evidence,
      inferenceCount: inspection._count.inferences,
      inspectedAt: inspection.capturedAt,
      engineVersion: inspection.engineVersion,
      algorithmVersion: inspection.algorithmVersion,
    };
  }

  /**
   * Resolve a storage key inside the report directory, refusing anything that
   * escapes it. Storage keys are generated server-side today, but this is the
   * function an S3 migration or an import path would reuse.
   */
  private resolveStoragePath(storageKey: string): string {
    const root = resolve(this.config.reportStorageDir);
    const target = resolve(root, storageKey);
    if (target !== root && !target.startsWith(root + '/')) {
      throw new NotFoundException('Invalid report location');
    }
    return target;
  }
}
