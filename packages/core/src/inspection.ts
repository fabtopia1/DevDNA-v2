import { collectEvidence } from './capture/collectors.js';
import type { RawDeviceSnapshot } from './capture/snapshot.js';
import { EvidenceLedger } from './evidence/ledger.js';
import { EvidenceSubject, type EvidenceRecord } from './evidence/types.js';
import { inferMarketingCapacityGb, resolveDevice } from './catalog/devices.js';
import { resolveRegion } from './catalog/regions.js';
import { decodeModelNumber, UnitProvenanceClass } from './catalog/identifiers.js';
import { ProvenanceEngine, type AuditEntry, type Violation } from './inference/provenance.js';
import { ModuleId, Severity, type Finding, type ModuleResult } from './inference/types.js';
import { runIdentityEngine, type IdentityDetail, type IdentityVerdict } from './modules/identity.js';
import { runHardwareEngine, type HardwareDetail, type HardwareVerdict } from './modules/hardware.js';
import { runServiceEngine, type ServiceDetail, type ServiceVerdict } from './modules/service.js';
import { runBatteryEngine, type BatteryDetail, type BatteryVerdict } from './modules/battery.js';
import { runSecurityEngine, type SecurityDetail, type SecurityVerdict } from './modules/security.js';
import { runTrustEngine, type TrustAssessment } from './modules/trust.js';

/**
 * Version of the whole engine bundle. Persisted with every inspection so a
 * historical report stays explainable by the code that produced it.
 */
export const ENGINE_VERSION = '2.0.0';

/**
 * The handful of facts every consumer needs for a header line.
 *
 * Derived once here rather than re-derived by the CLI, the API, the PDF and the
 * dashboard, which is how they drift apart. Identifiers are carried raw; the
 * API masks or hashes them on the way to storage.
 */
export interface DeviceSummary {
  productType: string | null;
  marketingName: string | null;
  modelRecognised: boolean;
  capacityGb: number | null;
  iosVersion: string | null;
  buildVersion: string | null;
  regionCode: string | null;
  regionName: string | null;
  serialNumber: string | null;
  imei: string | null;
  udid: string | null;
  unitProvenance: UnitProvenanceClass;
}

export interface InspectionReport {
  engineVersion: string;
  inspectedAt: string;
  device: DeviceSummary;
  /** Digest of the ledger this report was computed from. */
  ledgerDigest: string;
  /** The raw evidence. Persisted separately from every conclusion below. */
  evidence: EvidenceRecord[];
  modules: {
    identity: ModuleResult<IdentityVerdict>;
    hardware: ModuleResult<HardwareVerdict>;
    service: ModuleResult<ServiceVerdict>;
    battery: ModuleResult<BatteryVerdict>;
    security: ModuleResult<SecurityVerdict>;
  };
  details: {
    identity: IdentityDetail;
    hardware: HardwareDetail;
    service: ServiceDetail;
    battery: BatteryDetail;
    security: SecurityDetail;
  };
  trust: TrustAssessment;
  findings: Finding[];
  /** Ordered, replayable record of how this report was produced. */
  auditTrail: AuditEntry[];
  /**
   * Provenance violations found by the post-hoc audit. Always empty in a
   * correctly functioning system; surfaced rather than thrown so a single bad
   * rule degrades one report instead of failing the whole inspection.
   */
  provenanceViolations: Violation[];
}

export interface EvaluateOptions {
  /** Overrides the timestamp stamped on derived inferences. */
  at?: string;
}

/**
 * Run a full inspection from a raw capture.
 *
 * Two phases, deliberately separable: translate the snapshot into evidence,
 * then reason over the evidence. Nothing after `collectEvidence` ever sees the
 * snapshot.
 */
export function inspect(
  snapshot: RawDeviceSnapshot,
  options: EvaluateOptions = {},
): InspectionReport {
  const ledger = collectEvidence(snapshot);
  return evaluate(ledger, { at: options.at ?? snapshot.capturedAt });
}

/**
 * Reason over an evidence ledger.
 *
 * This is the reproducibility seam. A stored ledger is sufficient to recompute
 * every inference, verdict, score and audit entry, with no access to the
 * original device capture. That is what makes a historical inspection
 * defensible in a dispute and re-scorable under an improved engine.
 */
export function evaluate(source: EvidenceLedger, options: EvaluateOptions = {}): InspectionReport {
  const at = options.at ?? new Date().toISOString();
  // Work on a detached copy so evaluating a ledger never mutates the caller's,
  // and evaluating the same ledger twice gives the same answer.
  const ledger = source.clone();
  const provenance = new ProvenanceEngine(ledger);

  provenance.log({
    at,
    module: 'PIPELINE',
    action: 'EVIDENCE_COLLECTED',
    summary: `${ledger.size} evidence records available for evaluation`,
    refs: {},
  });

  const identity = runIdentityEngine(ledger, provenance, at);
  logModule(provenance, at, identity.result);

  const hardware = runHardwareEngine(ledger, provenance, at);
  logModule(provenance, at, hardware.result);

  const service = runServiceEngine(ledger, provenance, at);
  logModule(provenance, at, service.result);

  const battery = runBatteryEngine(ledger, provenance, at);
  logModule(provenance, at, battery.result);

  const security = runSecurityEngine(ledger, provenance, at);
  logModule(provenance, at, security.result);

  const trust = runTrustEngine(
    ledger,
    provenance,
    {
      identity: identity.result,
      hardware: hardware.result,
      service: service.result,
      battery: battery.result,
      security: security.result,
      details: {
        hardware: hardware.detail,
        service: service.detail,
        battery: battery.detail,
        security: security.detail,
      },
    },
    at,
  );

  const findings = dedupe([
    ...trust.findings,
    ...security.findings,
    ...identity.findings,
    ...hardware.findings,
    ...service.findings,
    ...battery.findings,
  ]);

  const modules = [
    identity.result,
    hardware.result,
    service.result,
    battery.result,
    security.result,
  ];

  return {
    engineVersion: ENGINE_VERSION,
    inspectedAt: at,
    device: summariseDevice(ledger),
    ledgerDigest: ledger.digest(),
    evidence: ledger.all(),
    modules: {
      identity: identity.result,
      hardware: hardware.result,
      service: service.result,
      battery: battery.result,
      security: security.result,
    },
    details: {
      identity: identity.detail,
      hardware: hardware.detail,
      service: service.detail,
      battery: battery.detail,
      security: security.detail,
    },
    trust: trust.assessment,
    findings,
    auditTrail: provenance.auditTrail(),
    provenanceViolations: ProvenanceEngine.audit(ledger, modules, findings),
  };
}

/** Re-score a persisted ledger under the current engine. */
export function evaluateStoredEvidence(
  records: readonly EvidenceRecord[],
  options: EvaluateOptions = {},
): InspectionReport {
  return evaluate(EvidenceLedger.from(records), options);
}

function summariseDevice(ledger: EvidenceLedger): DeviceSummary {
  const productType = ledger.string(EvidenceSubject.DEVICE, 'ProductType') ?? null;
  const device = resolveDevice(productType);
  const region = resolveRegion(ledger.string(EvidenceSubject.DEVICE, 'RegionInfo') ?? null);
  const modelNumber = decodeModelNumber(ledger.string(EvidenceSubject.DEVICE, 'ModelNumber'));
  const capacityBytes = ledger.number(EvidenceSubject.DEVICE, 'TotalDiskCapacity') ?? null;

  return {
    productType,
    marketingName: device.recognised ? device.marketingName : null,
    modelRecognised: device.recognised,
    capacityGb: inferMarketingCapacityGb(capacityBytes),
    iosVersion: ledger.string(EvidenceSubject.SYSTEM_SOFTWARE, 'ProductVersion') ?? null,
    buildVersion: ledger.string(EvidenceSubject.SYSTEM_SOFTWARE, 'BuildVersion') ?? null,
    regionCode: region.code,
    regionName: region.name,
    serialNumber: ledger.string(EvidenceSubject.DEVICE, 'SerialNumber') ?? null,
    imei: ledger.string(EvidenceSubject.DEVICE, 'InternationalMobileEquipmentIdentity') ?? null,
    udid: ledger.string(EvidenceSubject.DEVICE, 'UniqueDeviceID') ?? null,
    unitProvenance: modelNumber.provenanceClass,
  };
}

function logModule(provenance: ProvenanceEngine, at: string, result: ModuleResult): void {
  for (const verdict of result.verdicts) {
    provenance.log({
      at,
      module: result.module,
      action: 'VERDICT_CONCLUDED',
      summary: `${verdict.subject}: ${verdict.value} (${verdict.determinacy}, confidence ${verdict.confidence})`,
      refs: {
        verdictIds: [verdict.id],
        inferenceIds: verdict.inferenceIds,
        evidenceIds: verdict.evidenceIds,
      },
    });
  }
  provenance.log({
    at,
    module: result.module,
    action: 'MODULE_COMPLETED',
    summary: `coverage ${result.coverage}, confidence ${result.confidence}, ${result.inferences.length} inference(s)`,
    refs: {},
  });
}

const SEVERITY_ORDER: Record<Severity, number> = {
  [Severity.CRITICAL]: 0,
  [Severity.HIGH]: 1,
  [Severity.MEDIUM]: 2,
  [Severity.LOW]: 3,
  [Severity.INFO]: 4,
};

function dedupe(findings: readonly Finding[]): Finding[] {
  const seen = new Map<string, Finding>();
  for (const finding of findings) {
    if (!seen.has(finding.code)) seen.set(finding.code, finding);
  }
  return [...seen.values()].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export { ModuleId };
