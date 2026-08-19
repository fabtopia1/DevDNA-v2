import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ENGINE_VERSION,
  EvidenceLedger,
  evaluateStoredEvidence,
  hashIdentifier,
  inspect,
  resolveDevice,
  type EvidenceRecord,
  type Inference,
  type InspectionReport,
  type ModuleResult,
  type RawDeviceSnapshot,
  type Verdict,
} from '@devdna/core';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { CryptoService } from '../../common/crypto.service';
import { CONFIG_TOKEN, type AppConfig } from '../../config/configuration';

export interface IngestInput {
  organizationId: string;
  bridgeId?: string | null;
  userId?: string | null;
  customerId?: string | null;
  snapshot: RawDeviceSnapshot;
  /** The bridge's own scoring, kept only for divergence detection. */
  clientReport?: InspectionReport | null;
  workstation?: string | null;
}

export interface ListFilters {
  page: number;
  pageSize: number;
  verdict?: string;
  search?: string;
  deviceId?: string;
  /** Filter to inspections where a given component was replaced. */
  replacedComponent?: string;
  from?: Date;
  to?: Date;
}

@Injectable()
export class InspectionsService {
  private readonly logger = new Logger(InspectionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
  ) {}

  /**
   * Accept a snapshot and produce the authoritative inspection record.
   *
   * The server always re-scores the raw capture rather than storing whatever
   * the bridge computed: the bridge runs on hardware the shop controls, and a
   * shop about to sell a handset has an obvious incentive to inflate its own
   * number.
   *
   * Evidence, inferences, verdicts and the audit trail are written as separate
   * rows. That is not normalisation for its own sake - it is what lets a
   * dispute be answered by pointing at the specific observation behind a
   * verdict, and what lets a stored ledger be re-scored later without the old
   * conclusions being in the way.
   */
  async ingest(input: IngestInput) {
    assertValidSnapshot(input.snapshot);

    const organization = await this.prisma.organization.findUnique({
      where: { id: input.organizationId },
      select: { id: true, identifierSalt: true },
    });
    if (!organization) throw new NotFoundException('Organization not found');

    const report = inspect(input.snapshot);

    if (report.provenanceViolations.length > 0) {
      // Never silent. A violation means a conclusion in this report cannot
      // point at its support, which is the one thing the system must not do.
      this.logger.error(
        `Provenance violations in inspection of ${report.device.productType}: ` +
          report.provenanceViolations.map((v) => `${v.code} ${v.message}`).join('; '),
      );
    }

    if (input.clientReport && input.clientReport.trust.score !== report.trust.score) {
      // Not an error: a bridge on an older engine legitimately scores
      // differently. Logged because a persistent gap is worth noticing.
      this.logger.warn(
        `Bridge score ${input.clientReport.trust.score} diverged from server score ` +
          `${report.trust.score} (bridge engine ${input.clientReport.engineVersion}, server ${ENGINE_VERSION})`,
      );
    }

    const device = await this.upsertDevice(organization, report);
    const inspection = await this.persist({ input, organization, report, deviceId: device.id });

    await this.audit.record({
      organizationId: organization.id,
      actorType: input.bridgeId ? 'BRIDGE' : 'USER',
      actorId: input.bridgeId ?? input.userId ?? null,
      action: 'inspection.created',
      entity: 'Inspection',
      entityId: inspection.id,
      metadata: {
        trustScore: report.trust.score,
        verdict: report.trust.verdict,
        confidence: report.trust.confidence,
        evidenceCount: report.evidence.length,
        ledgerDigest: report.ledgerDigest,
        workstation: input.workstation ?? null,
        engineVersion: report.engineVersion,
      },
    });

    return { id: inspection.id, deviceId: device.id, report: this.redactReport(report) };
  }

  private async upsertDevice(
    organization: { id: string; identifierSalt: string },
    report: InspectionReport,
  ) {
    const { device } = report;
    const udid = device.udid;
    if (!udid) {
      throw new BadRequestException('Snapshot does not identify a device (missing UniqueDeviceID)');
    }

    const udidHash = hashIdentifier(udid, organization.identifierSalt);
    const catalog = resolveDevice(device.productType);
    const retainPlaintext = this.config.retainPlaintextIdentifiers;

    return this.prisma.device.upsert({
      where: { organizationId_udidHash: { organizationId: organization.id, udidHash } },
      create: {
        organizationId: organization.id,
        udidHash,
        serialHash: device.serialNumber
          ? hashIdentifier(device.serialNumber, organization.identifierSalt)
          : null,
        udid: retainPlaintext ? udid : null,
        serialNumber: retainPlaintext ? device.serialNumber : null,
        productType: device.productType ?? 'unknown',
        marketingName: catalog.marketingName,
        capacityGb: device.capacityGb,
        regionCode: device.regionCode,
        regionName: device.regionName,
        inspectionCount: 1,
      },
      update: {
        lastSeenAt: new Date(),
        inspectionCount: { increment: 1 },
        marketingName: catalog.marketingName,
        capacityGb: device.capacityGb,
      },
    });
  }

  private async persist(args: {
    input: IngestInput;
    organization: { id: string; identifierSalt: string };
    report: InspectionReport;
    deviceId: string;
  }) {
    const { input, organization, report, deviceId } = args;
    const { trust, details, modules } = report;
    const retainPlaintext = this.config.retainPlaintextIdentifiers;

    // Widened to the base types: the module map is heterogeneous by verdict
    // vocabulary, and persistence is uniform across all of them.
    const moduleResults: ModuleResult[] = Object.values(modules);
    const allInferences: Inference[] = moduleResults.flatMap((m) => m.inferences);
    const allVerdicts: Verdict[] = moduleResults.flatMap((m) => m.verdicts);

    return this.prisma.inspection.create({
      data: {
        organizationId: organization.id,
        deviceId,
        userId: input.userId ?? null,
        bridgeId: input.bridgeId ?? null,
        customerId: input.customerId ?? null,
        status: 'COMPLETE',

        trustVerdict: trust.verdict,
        trustScore: trust.score,
        rawTrustScore: trust.rawScore,
        confidence: trust.confidence,
        coverage: trust.coverage,

        identityVerdict: modules.identity.verdicts[0]?.value ?? null,
        hardwareVerdict: modules.hardware.verdicts[0]?.value ?? null,
        securityVerdict: modules.security.verdicts[0]?.value ?? null,
        batteryVerdict: modules.battery.verdicts[0]?.value ?? null,

        batteryHealthPercent: details.battery.maximumCapacityPercent,
        batteryCycleCount: details.battery.cycleCount,
        batteryWearGrade: details.battery.wearGrade,
        batteryReplacementRisk: details.battery.replacementLikelihood,
        securityPostureScore: details.security.postureScore,
        hardwareAnomalyCount: details.hardware.anomalies.length,
        componentsReplacedCount: details.service.replacedCount,
        componentsIndeterminate: details.service.indeterminateCount,
        iosVersion: report.device.iosVersion,
        buildVersion: report.device.buildVersion,
        unitProvenance: report.device.unitProvenance,

        engineVersion: report.engineVersion,
        algorithmVersion: trust.algorithmVersion,
        ledgerDigest: report.ledgerDigest,

        snapshot: sanitiseSnapshot(input.snapshot, retainPlaintext) as unknown as Prisma.InputJsonValue,
        report: this.redactReport(report) as unknown as Prisma.InputJsonValue,

        capturedAt: new Date(input.snapshot.capturedAt),

        evidence: {
          create: report.evidence.map((record) => ({
            evidenceId: record.id,
            kind: record.kind,
            subject: record.subject,
            key: record.key,
            value: this.encodeEvidenceValue(record) as Prisma.InputJsonValue,
            sourceAuthority: record.provenance.source,
            method: record.provenance.method,
            collector: record.provenance.collector,
            observedAt: new Date(record.provenance.observedAt),
            reliability: record.provenance.reliability,
            instrument: record.provenance.instrument ?? null,
            raw: record.raw ?? null,
            note: record.note ?? null,
          })),
        },
        inferences: {
          create: allInferences.map((inference) => ({
            inferenceId: inference.id,
            module: inference.module,
            rule: inference.rule,
            subject: inference.subject,
            direction: inference.direction,
            statement: inference.statement,
            weight: inference.weight,
            confidence: inference.confidence,
            evidenceIds: inference.evidenceIds,
            derivedAt: new Date(inference.derivedAt),
          })),
        },
        verdicts: {
          create: allVerdicts.map((verdict) => ({
            verdictId: verdict.id,
            module: verdict.module,
            subject: verdict.subject,
            value: verdict.value,
            determinacy: verdict.determinacy,
            confidence: verdict.confidence,
            rationale: verdict.rationale.slice(0, 1000),
            inferenceIds: verdict.inferenceIds,
            evidenceIds: verdict.evidenceIds,
          })),
        },
        components: {
          create: details.service.components.map((component) => ({
            subject: component.subject,
            verdict: component.verdict,
            authenticity: component.authenticity,
            confidence: component.confidence,
            rationale: component.rationale.slice(0, 1000),
          })),
        },
        findings: {
          create: report.findings.map((finding) => ({
            code: finding.code,
            severity: finding.severity,
            module: finding.module,
            title: finding.title.slice(0, 300),
            detail: finding.detail.slice(0, 2000),
            basis: finding.basis,
            evidenceIds: finding.evidenceIds,
            inferenceIds: finding.inferenceIds,
          })),
        },
        auditEntries: {
          create: report.auditTrail.map((entry) => ({
            sequence: entry.sequence,
            at: new Date(entry.at),
            module: entry.module,
            action: entry.action,
            summary: entry.summary.slice(0, 1000),
            refs: entry.refs as unknown as Prisma.InputJsonValue,
          })),
        },
      },
      select: { id: true },
    });
  }

  async list(organizationId: string, filters: ListFilters) {
    const where: Prisma.InspectionWhereInput = {
      organizationId,
      ...(filters.verdict ? { trustVerdict: filters.verdict as never } : {}),
      ...(filters.deviceId ? { deviceId: filters.deviceId } : {}),
      ...(filters.replacedComponent
        ? {
            components: {
              some: { subject: filters.replacedComponent as never, verdict: 'REPLACED_LIKELY' },
            },
          }
        : {}),
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
          componentsReplacedCount: true,
          hardwareAnomalyCount: true,
          iosVersion: true,
          unitProvenance: true,
          device: {
            select: { id: true, marketingName: true, productType: true, capacityGb: true, regionName: true },
          },
          user: { select: { id: true, name: true } },
          _count: { select: { reports: true, evidence: true } },
        },
      }),
    ]);

    return {
      items: items.map((item) => ({
        ...item,
        reportCount: item._count.reports,
        evidenceCount: item._count.evidence,
        _count: undefined,
      })),
      page: filters.page,
      pageSize: filters.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / filters.pageSize)),
    };
  }

  async get(organizationId: string, id: string) {
    const inspection = await this.prisma.inspection.findFirst({
      // Tenancy is part of the lookup, not a post-hoc check.
      where: { id, organizationId },
      include: {
        device: true,
        user: { select: { id: true, name: true, email: true } },
        bridge: { select: { id: true, name: true, workstation: true } },
        customer: true,
        components: true,
        findings: true,
        verdicts: true,
        reports: {
          select: { id: true, publicId: true, createdAt: true, sizeBytes: true, downloadCount: true },
          orderBy: { createdAt: 'desc' },
        },
        _count: { select: { evidence: true, inferences: true, auditEntries: true } },
      },
    });
    if (!inspection) throw new NotFoundException('Inspection not found');
    return inspection;
  }

  /**
   * The evidence behind one inspection.
   *
   * Served separately from the inspection itself because it is large and
   * because the separation is the point: a caller can fetch conclusions
   * without evidence, or evidence without conclusions, and the two are never
   * conflated.
   */
  async evidence(organizationId: string, id: string, filters: { subject?: string } = {}) {
    const inspection = await this.prisma.inspection.findFirst({
      where: { id, organizationId },
      select: { id: true, ledgerDigest: true },
    });
    if (!inspection) throw new NotFoundException('Inspection not found');

    const [records, inferences] = await Promise.all([
      this.prisma.evidenceRecordRow.findMany({
        where: {
          inspectionId: id,
          ...(filters.subject ? { subject: filters.subject as never } : {}),
        },
        orderBy: [{ subject: 'asc' }, { key: 'asc' }],
      }),
      this.prisma.inferenceRow.findMany({
        where: { inspectionId: id },
        orderBy: [{ module: 'asc' }, { rule: 'asc' }],
      }),
    ]);

    return {
      ledgerDigest: inspection.ledgerDigest,
      // Masked at the boundary. The stored value stays intact so the ledger
      // remains reproducible; the caller never needs the raw identifier.
      evidence: records.map((record) => ({
        ...record,
        value: this.presentEvidenceValue(record.key, record.value),
      })),
      inferences,
    };
  }

  /** Decrypt for internal use, then mask for display. */
  private presentEvidenceValue(key: string, stored: unknown): unknown {
    const value = this.decodeEvidenceValue(stored);
    if (!IDENTIFYING_KEYS.has(key)) return value;
    if (this.config.retainPlaintextIdentifiers) return value;
    return typeof value === 'string' ? maskTail(value) : '[redacted]';
  }

  /** The ordered record of how a stored inspection was produced. */
  async auditTrail(organizationId: string, id: string) {
    const inspection = await this.prisma.inspection.findFirst({
      where: { id, organizationId },
      select: { id: true },
    });
    if (!inspection) throw new NotFoundException('Inspection not found');

    return this.prisma.auditEntryRow.findMany({
      where: { inspectionId: id },
      orderBy: { sequence: 'asc' },
    });
  }

  /**
   * Re-score stored evidence under the current engine.
   *
   * Reads the persisted ledger, not the snapshot, which is the whole point of
   * storing evidence as first-class rows. The ledger's integrity is verified
   * against its digest first: re-scoring tampered evidence would launder an
   * edit into a fresh, apparently authoritative verdict.
   *
   * Creates a new inspection rather than mutating the old one, because a report
   * already given to a trading partner must keep saying what it said.
   */
  async rescore(organizationId: string, id: string, userId: string) {
    const existing = await this.prisma.inspection.findFirst({
      where: { id, organizationId },
      select: {
        snapshot: true,
        customerId: true,
        bridgeId: true,
        deviceId: true,
        ledgerDigest: true,
        engineVersion: true,
        evidence: true,
      },
    });
    if (!existing) throw new NotFoundException('Inspection not found');

    const records: EvidenceRecord[] = existing.evidence.map((row) =>
      rowToEvidenceRecord({ ...row, value: this.decodeEvidenceValue(row.value) }),
    );
    const ledger = EvidenceLedger.from(records);

    if (ledger.digest() !== existing.ledgerDigest) {
      throw new BadRequestException(
        'Stored evidence does not match the digest recorded at inspection time; refusing to re-score.',
      );
    }
    const integrity = ledger.verifyIntegrity();
    if (!integrity.ok) {
      throw new BadRequestException(
        `Stored evidence failed integrity verification (${integrity.mismatched.length} record(s)); refusing to re-score.`,
      );
    }

    const report = evaluateStoredEvidence(records);

    const inspection = await this.persist({
      input: {
        organizationId,
        userId,
        customerId: existing.customerId,
        bridgeId: existing.bridgeId,
        snapshot: existing.snapshot as unknown as RawDeviceSnapshot,
      },
      organization: { id: organizationId, identifierSalt: '' },
      report,
      deviceId: existing.deviceId,
    });

    await this.audit.record({
      organizationId,
      actorType: 'USER',
      actorId: userId,
      action: 'inspection.rescored',
      entity: 'Inspection',
      entityId: inspection.id,
      metadata: {
        sourceInspectionId: id,
        previousEngineVersion: existing.engineVersion,
        engineVersion: report.engineVersion,
        trustScore: report.trust.score,
      },
    });

    return { id: inspection.id, deviceId: existing.deviceId, report: this.redactReport(report) };
  }

  /**
   * Identifying evidence values are encrypted at rest, not redacted.
   *
   * Redacting them looked like the privacy-preserving choice and was in fact a
   * correctness bug: the evidence ledger is what re-scoring reads, so a masked
   * IMEI would be re-checked against its Luhn digit on the next re-score and
   * come back as an identity mismatch. Worse, the mask changes the ledger, so
   * the digest no longer verifies and genuine tampering becomes
   * indistinguishable from our own redaction.
   *
   * Encrypting instead keeps the ledger reproducible and its digest meaningful,
   * while a database leak alone still yields no identifiers. Masking happens at
   * the API boundary, where it belongs.
   */
  private encodeEvidenceValue(record: EvidenceRecord): unknown {
    if (this.config.retainPlaintextIdentifiers) return record.value;
    if (!IDENTIFYING_KEYS.has(record.key)) return record.value;
    return { __enc: this.crypto.encrypt(JSON.stringify(record.value)) };
  }

  private decodeEvidenceValue(value: unknown): unknown {
    if (!isEncrypted(value)) return value;
    return JSON.parse(this.crypto.decrypt(value.__enc));
  }

  /** Mask device identifiers unless the tenant has opted in to retaining them. */
  private redactReport(report: InspectionReport): InspectionReport {
    if (this.config.retainPlaintextIdentifiers) return report;
    return {
      ...report,
      device: {
        ...report.device,
        udid: '[redacted]',
        serialNumber: report.device.serialNumber ? maskTail(report.device.serialNumber) : null,
        imei: report.device.imei ? maskTail(report.device.imei) : null,
      },
      // Masked on the way out. The stored record keeps its real value, so the
      // conclusions that cite it stay reproducible.
      evidence: report.evidence.map((record) =>
        IDENTIFYING_KEYS.has(record.key) && typeof record.value === 'string'
          ? { ...record, value: maskTail(record.value) }
          : record,
      ),
    };
  }
}

/** Evidence keys whose values identify a specific handset. */
const IDENTIFYING_KEYS = new Set([
  'UniqueDeviceID',
  'SerialNumber',
  'InternationalMobileEquipmentIdentity',
  'InternationalMobileEquipmentIdentity2',
  'MobileEquipmentIdentifier',
  'UniqueChipID',
  'CellSerial',
]);

/** Envelope marking an encrypted evidence value in the database. */
interface EncryptedValue {
  __enc: string;
}

const isEncrypted = (value: unknown): value is EncryptedValue =>
  typeof value === 'object' && value !== null && '__enc' in value;

function sanitiseSnapshot(snapshot: RawDeviceSnapshot, retainPlaintext: boolean): RawDeviceSnapshot {
  if (retainPlaintext) return snapshot;
  const lockdown = { ...snapshot.lockdown };
  for (const key of [
    ...IDENTIFYING_KEYS,
    'IntegratedCircuitCardIdentity',
    'InternationalMobileSubscriberIdentity',
    'BluetoothAddress',
    'WiFiAddress',
    'EthernetAddress',
  ]) {
    if (key in lockdown) lockdown[key] = '[redacted]';
  }
  return { ...snapshot, lockdown };
}

/** Keep the last four characters so a technician can still match a handset. */
const maskTail = (value: string): string =>
  value.length <= 4 ? '****' : `${'*'.repeat(value.length - 4)}${value.slice(-4)}`;

/** Database row back into the engine's evidence shape, losslessly. */
function rowToEvidenceRecord(row: {
  evidenceId: string;
  kind: string;
  subject: string;
  key: string;
  value: unknown;
  sourceAuthority: string;
  method: string;
  collector: string;
  observedAt: Date;
  reliability: number;
  instrument: string | null;
  raw: string | null;
  note: string | null;
}): EvidenceRecord {
  return {
    id: row.evidenceId,
    kind: row.kind as EvidenceRecord['kind'],
    subject: row.subject as EvidenceRecord['subject'],
    key: row.key,
    value: row.value as EvidenceRecord['value'],
    provenance: {
      source: row.sourceAuthority as EvidenceRecord['provenance']['source'],
      method: row.method as EvidenceRecord['provenance']['method'],
      collector: row.collector,
      observedAt: row.observedAt.toISOString(),
      reliability: row.reliability,
      ...(row.instrument ? { instrument: row.instrument } : {}),
    },
    ...(row.raw ? { raw: row.raw } : {}),
    ...(row.note ? { note: row.note } : {}),
  };
}

/**
 * Validate the shape of an incoming snapshot.
 *
 * A bridge is authenticated but not trusted, so every field the collectors read
 * is checked for presence and type here rather than assumed.
 */
function assertValidSnapshot(
  snapshot: RawDeviceSnapshot | undefined,
): asserts snapshot is RawDeviceSnapshot {
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
