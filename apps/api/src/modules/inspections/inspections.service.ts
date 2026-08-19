import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ENGINE_VERSION,
  hashIdentifier,
  resolveDevice,
  runInspection,
  type InspectionResult,
  type RawDeviceSnapshot,
} from '@devdna/core';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { CONFIG_TOKEN, type AppConfig } from '../../config/configuration';
import { Inject } from '@nestjs/common';

export interface IngestInput {
  organizationId: string;
  bridgeId?: string | null;
  userId?: string | null;
  customerId?: string | null;
  snapshot: RawDeviceSnapshot;
  /** The bridge's own scoring, kept only for divergence detection. */
  clientResult?: InspectionResult | null;
  workstation?: string | null;
}

export interface ListFilters {
  page: number;
  pageSize: number;
  status?: string;
  search?: string;
  deviceId?: string;
  from?: Date;
  to?: Date;
}

@Injectable()
export class InspectionsService {
  private readonly logger = new Logger(InspectionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
  ) {}

  /**
   * Accept a snapshot and produce the authoritative inspection record.
   *
   * The server always re-scores the raw snapshot rather than storing whatever
   * the bridge computed. The bridge runs on hardware the shop controls, and a
   * shop has an obvious incentive to inflate a trust score before selling a
   * handset on. Its result is compared and logged when it diverges, but never
   * trusted.
   */
  async ingest(input: IngestInput) {
    const snapshot = input.snapshot;
    assertValidSnapshot(snapshot);

    const organization = await this.prisma.organization.findUnique({
      where: { id: input.organizationId },
      select: { id: true, identifierSalt: true },
    });
    if (!organization) throw new NotFoundException('Organization not found');

    const result = runInspection(snapshot, { udidSalt: organization.identifierSalt });
    const identity = result.identity;

    if (!identity.udidHash) {
      throw new BadRequestException('Snapshot does not identify a device (missing UniqueDeviceID)');
    }

    if (input.clientResult && input.clientResult.trust.score !== result.trust.score) {
      // Not an error: a bridge on an older engine legitimately scores
      // differently. It is logged because a persistent gap is worth noticing.
      this.logger.warn(
        `Bridge score ${input.clientResult.trust.score} diverged from server score ` +
          `${result.trust.score} (bridge engine ${input.clientResult.engineVersion}, server ${ENGINE_VERSION})`,
      );
    }

    const catalog = resolveDevice(identity.productType);
    const retainPlaintext = this.config.retainPlaintextIdentifiers;

    const device = await this.prisma.device.upsert({
      where: {
        organizationId_udidHash: {
          organizationId: organization.id,
          udidHash: identity.udidHash,
        },
      },
      create: {
        organizationId: organization.id,
        udidHash: identity.udidHash,
        serialHash: identity.serialNumber
          ? hashIdentifier(identity.serialNumber, organization.identifierSalt)
          : null,
        udid: retainPlaintext ? identity.udid : null,
        serialNumber: retainPlaintext ? identity.serialNumber : null,
        productType: identity.productType,
        marketingName: catalog.marketingName,
        capacityGb: identity.marketingCapacityGb,
        regionCode: identity.regionCode,
        regionName: identity.regionName,
        inspectionCount: 1,
      },
      update: {
        lastSeenAt: new Date(),
        inspectionCount: { increment: 1 },
        marketingName: catalog.marketingName,
        capacityGb: identity.marketingCapacityGb,
      },
    });

    const inspection = await this.prisma.inspection.create({
      data: {
        organizationId: organization.id,
        deviceId: device.id,
        userId: input.userId ?? null,
        bridgeId: input.bridgeId ?? null,
        customerId: input.customerId ?? null,
        status: 'COMPLETE',
        verificationStatus: result.trust.status,
        trustScore: result.trust.score,
        rawTrustScore: result.trust.rawScore,
        confidence: result.trust.confidence,
        batteryScore: result.battery.score,
        softwareScore: result.software.score,
        partsScore: result.parts.score,
        partsCoverage: result.parts.coverage,
        batteryHealthPercent: result.battery.maximumCapacityPercent?.value ?? null,
        batteryCycleCount: result.battery.cycleCount?.value ?? null,
        iosVersion: identity.iosVersion,
        buildVersion: identity.buildVersion,
        engineVersion: result.engineVersion,
        algorithmVersion: result.trust.algorithmVersion,
        // The raw capture is stored with plaintext identifiers stripped unless
        // the tenant opted in, so a snapshot dump is not a UDID dump.
        snapshot: sanitiseSnapshot(snapshot, retainPlaintext) as unknown as Prisma.InputJsonValue,
        result: sanitiseResult(result, retainPlaintext) as unknown as Prisma.InputJsonValue,
        capturedAt: new Date(snapshot.capturedAt),
        partResults: {
          create: result.parts.results.map((part) => ({
            component: part.component,
            verdict: part.verdict,
            confidence: part.confidence,
            weight: part.weight,
            rationale: part.rationale.slice(0, 1000),
          })),
        },
        findings: {
          create: result.findings.map((finding) => ({
            code: finding.code,
            severity: finding.severity,
            title: finding.title.slice(0, 300),
            detail: finding.detail.slice(0, 2000),
            source: finding.source,
          })),
        },
      },
      include: { device: true },
    });

    await this.audit.record({
      organizationId: organization.id,
      actorType: input.bridgeId ? 'BRIDGE' : 'USER',
      actorId: input.bridgeId ?? input.userId ?? null,
      action: 'inspection.created',
      entity: 'Inspection',
      entityId: inspection.id,
      metadata: {
        trustScore: result.trust.score,
        status: result.trust.status,
        workstation: input.workstation ?? null,
        engineVersion: result.engineVersion,
      },
    });

    return { id: inspection.id, deviceId: device.id, result };
  }

  async list(organizationId: string, filters: ListFilters) {
    const where: Prisma.InspectionWhereInput = {
      organizationId,
      ...(filters.status ? { verificationStatus: filters.status as never } : {}),
      ...(filters.deviceId ? { deviceId: filters.deviceId } : {}),
      ...(filters.from || filters.to
        ? {
            createdAt: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {}),
            },
          }
        : {}),
      ...(filters.search
        ? {
            device: {
              OR: [
                { marketingName: { contains: filters.search, mode: 'insensitive' } },
                { productType: { contains: filters.search, mode: 'insensitive' } },
                { serialNumber: { contains: filters.search, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    };

    const [total, items] = await Promise.all([
      this.prisma.inspection.count({ where }),
      this.prisma.inspection.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
        select: {
          id: true,
          createdAt: true,
          capturedAt: true,
          trustScore: true,
          verificationStatus: true,
          batteryScore: true,
          softwareScore: true,
          partsScore: true,
          confidence: true,
          batteryHealthPercent: true,
          batteryCycleCount: true,
          iosVersion: true,
          device: {
            select: { id: true, marketingName: true, productType: true, capacityGb: true, regionName: true },
          },
          user: { select: { id: true, name: true } },
          _count: { select: { reports: true } },
        },
      }),
    ]);

    return {
      items: items.map((item) => ({ ...item, reportCount: item._count.reports, _count: undefined })),
      page: filters.page,
      pageSize: filters.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / filters.pageSize)),
    };
  }

  async get(organizationId: string, id: string) {
    const inspection = await this.prisma.inspection.findFirst({
      // Tenancy is part of the lookup, not a post-hoc check — there is no code
      // path here that can read another organization's inspection.
      where: { id, organizationId },
      include: {
        device: true,
        user: { select: { id: true, name: true, email: true } },
        bridge: { select: { id: true, name: true, workstation: true } },
        customer: true,
        partResults: true,
        findings: true,
        reports: {
          select: { id: true, publicId: true, createdAt: true, sizeBytes: true, downloadCount: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!inspection) throw new NotFoundException('Inspection not found');
    return inspection;
  }

  /**
   * Re-score a stored snapshot under the current engine.
   *
   * Creates a new inspection rather than mutating the old one: a report already
   * given to a trading partner must keep saying what it said.
   */
  async rescore(organizationId: string, id: string, userId: string) {
    const existing = await this.prisma.inspection.findFirst({
      where: { id, organizationId },
      select: { snapshot: true, customerId: true, bridgeId: true },
    });
    if (!existing) throw new NotFoundException('Inspection not found');

    return this.ingest({
      organizationId,
      userId,
      customerId: existing.customerId,
      bridgeId: existing.bridgeId,
      snapshot: existing.snapshot as unknown as RawDeviceSnapshot,
    });
  }
}

/**
 * Validate the shape of an incoming snapshot.
 *
 * The controller DTO deliberately does not deep-validate this structure — it
 * is large, nested and versioned, and the schema contract belongs to the
 * service that consumes it. A bridge is authenticated but not trusted, so
 * every field the engines read is checked for presence and type here rather
 * than assumed.
 */
function assertValidSnapshot(snapshot: RawDeviceSnapshot | undefined): asserts snapshot is RawDeviceSnapshot {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new BadRequestException('Snapshot is missing');
  }
  if (snapshot.schemaVersion !== 1) {
    throw new BadRequestException(
      `Unsupported snapshot schema version: ${String(snapshot.schemaVersion)}`,
    );
  }
  if (typeof snapshot.capturedAt !== 'string' || Number.isNaN(Date.parse(snapshot.capturedAt))) {
    throw new BadRequestException('Snapshot capturedAt must be an ISO-8601 timestamp');
  }
  if (!snapshot.lockdown || typeof snapshot.lockdown !== 'object' || Array.isArray(snapshot.lockdown)) {
    throw new BadRequestException('Snapshot lockdown domain must be an object');
  }
  for (const key of ['domains', 'ioregistry'] as const) {
    const value = snapshot[key];
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException(`Snapshot ${key} must be an object`);
    }
  }
  for (const key of ['installedApps', 'services', 'errors'] as const) {
    if (!Array.isArray(snapshot[key])) {
      throw new BadRequestException(`Snapshot ${key} must be an array`);
    }
  }
  if (!snapshot.bridge || typeof snapshot.bridge.mode !== 'string') {
    throw new BadRequestException('Snapshot is missing bridge metadata');
  }
}

/**
 * Strip raw device identifiers from the stored JSON unless the tenant has
 * opted in. The hashed identity in the relational columns is what queries use,
 * so nothing downstream needs the plaintext.
 */
function sanitiseSnapshot(snapshot: RawDeviceSnapshot, retainPlaintext: boolean): RawDeviceSnapshot {
  if (retainPlaintext) return snapshot;
  const redactedKeys = [
    'UniqueDeviceID',
    'SerialNumber',
    'InternationalMobileEquipmentIdentity',
    'InternationalMobileEquipmentIdentity2',
    'MobileEquipmentIdentifier',
    'IntegratedCircuitCardIdentity',
    'InternationalMobileSubscriberIdentity',
    'UniqueChipID',
    'BluetoothAddress',
    'WiFiAddress',
    'EthernetAddress',
  ];
  const lockdown = { ...snapshot.lockdown };
  for (const key of redactedKeys) {
    if (key in lockdown) lockdown[key] = '[redacted]';
  }
  return { ...snapshot, lockdown };
}

function sanitiseResult(result: InspectionResult, retainPlaintext: boolean): InspectionResult {
  if (retainPlaintext) return result;
  return {
    ...result,
    identity: {
      ...result.identity,
      udid: '[redacted]',
      serialNumber: result.identity.serialNumber ? maskTail(result.identity.serialNumber) : null,
      imei: result.identity.imei ? maskTail(result.identity.imei) : null,
      meid: null,
      eid: null,
    },
  };
}

/** Keep the last four characters so a technician can still match a handset. */
const maskTail = (value: string): string =>
  value.length <= 4 ? '****' : `${'*'.repeat(value.length - 4)}${value.slice(-4)}`;
