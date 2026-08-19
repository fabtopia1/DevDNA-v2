/** Shapes returned by the DevDNA API, as consumed by the dashboard. */

export type TrustVerdict =
  | 'TRUSTED'
  | 'TRUSTED_WITH_NOTES'
  | 'CAUTION'
  | 'UNTRUSTED'
  | 'INSUFFICIENT_EVIDENCE';

export type ServiceVerdict = 'ORIGINAL_LIKELY' | 'REPLACED_LIKELY' | 'CANNOT_DETERMINE';

export type PartAuthenticity =
  | 'GENUINE_APPLE'
  | 'GENUINE_TRANSPLANTED'
  | 'NOT_VERIFIED'
  | 'UNKNOWN';

export type Determinacy = 'DETERMINED' | 'INDETERMINATE';
export type FindingBasis = 'EVIDENCE' | 'ABSENCE';
export type Severity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type ModuleId =
  | 'IDENTITY'
  | 'HARDWARE_CONSISTENCY'
  | 'SERVICE_EVIDENCE'
  | 'BATTERY_INTELLIGENCE'
  | 'SECURITY_DNA'
  | 'TRUST';

export interface DashboardSummary {
  windowDays: number;
  totals: {
    inspections: number;
    inspectionsInWindow: number;
    devices: number;
    trusted: number;
    flagged: number;
    insufficientEvidence: number;
  };
  averages: {
    trustScore: number | null;
    confidence: number | null;
    coverage: number | null;
    batteryHealthPercent: number | null;
    securityPostureScore: number | null;
  };
  verdictBreakdown: Record<string, number>;
  componentOutcomes: Array<{
    component: string;
    verdict: ServiceVerdict;
    authenticity: PartAuthenticity;
    count: number;
  }>;
  /** Where the engine is blind: determined vs indeterminate, per module. */
  moduleCoverage: Array<{ module: ModuleId; determinacy: Determinacy; count: number }>;
  failingCollectors: Array<{ collector: string; failures: number }>;
  topFindings: Array<{ code: string; severity: Severity; module: ModuleId; count: number }>;
  recent: Array<{
    id: string;
    createdAt: string;
    trustScore: number;
    trustVerdict: TrustVerdict;
    confidence: number;
    componentsReplacedCount: number;
    device: { marketingName: string; capacityGb: number | null };
    user: { name: string } | null;
  }>;
}

export interface InspectionListItem {
  id: string;
  createdAt: string;
  capturedAt: string;
  trustScore: number;
  rawTrustScore: number;
  trustVerdict: TrustVerdict;
  confidence: number;
  coverage: number;
  identityVerdict: string | null;
  hardwareVerdict: string | null;
  securityVerdict: string | null;
  batteryVerdict: string | null;
  batteryHealthPercent: number | null;
  batteryCycleCount: number | null;
  batteryWearGrade: string | null;
  componentsReplacedCount: number;
  hardwareAnomalyCount: number;
  iosVersion: string | null;
  unitProvenance: string | null;
  reportCount: number;
  evidenceCount: number;
  device: {
    id: string;
    marketingName: string;
    productType: string;
    capacityGb: number | null;
    regionName: string | null;
  };
  user: { id: string; name: string } | null;
}

export interface InspectionList {
  items: InspectionListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ComponentServiceRow {
  id: string;
  subject: string;
  verdict: ServiceVerdict;
  authenticity: PartAuthenticity;
  confidence: number;
  rationale: string;
}

export interface ModuleVerdictRow {
  id: string;
  verdictId: string;
  module: ModuleId;
  subject: string;
  value: string;
  determinacy: Determinacy;
  confidence: number;
  rationale: string;
  inferenceIds: string[];
  evidenceIds: string[];
}

export interface FindingRow {
  id: string;
  code: string;
  severity: Severity;
  module: ModuleId;
  title: string;
  detail: string;
  basis: FindingBasis;
  evidenceIds: string[];
  inferenceIds: string[];
}

/** The engine's report, as stored on the inspection. */
export interface StoredReport {
  engineVersion: string;
  inspectedAt: string;
  ledgerDigest: string;
  device: {
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
    unitProvenance: string;
  };
  details: {
    identity: {
      checksPerformed: string[];
      checksUnavailable: string[];
      unitProvenance: string;
      imei: { checksumValid: boolean; wellFormed: boolean } | null;
    };
    hardware: {
      modelCatalogued: boolean;
      expectedChip: string | null;
      anomalies: Array<{
        check: string;
        observed: string;
        expected: string;
        severity: Severity;
        explanation: string;
      }>;
      checksPerformed: string[];
      checksUnavailable: string[];
    };
    service: {
      components: ComponentServiceRow[];
      attestationPresent: boolean;
      serviceHistorySectionAbsent: boolean;
      replacedCount: number;
      originalCount: number;
      indeterminateCount: number;
    };
    battery: {
      maximumCapacityPercent: number | null;
      cycleCount: number | null;
      designCapacityMah: number | null;
      ratedCycleLife: number;
      wearGrade: string;
      healthConfidence: number;
      replacementLikelihood: number | null;
      replacementWindowMonths: number;
      wearRatePer100Cycles: number | null;
      sourcesUsed: string[];
      assumptions: string[];
    };
    security: {
      postureScore: number;
      integrityCompromised: boolean;
      jailbreakIndicators: string[];
      activationLockEnabled: boolean | null;
      supervised: boolean | null;
      passcodeSet: boolean | null;
      deductions: Array<{ code: string; points: number; reason: string }>;
    };
  };
  trust: {
    score: number;
    rawScore: number;
    confidence: number;
    confidenceBand: string;
    verdict: TrustVerdict;
    coverage: number;
    pillars: Array<{
      module: ModuleId;
      score: number | null;
      confidence: number;
      coverage: number;
      baseWeight: number;
      effectiveWeight: number;
    }>;
    gatesApplied: Array<{ code: string; cap: number; reason: string; module: ModuleId }>;
    algorithmVersion: string;
  };
  provenanceViolations: Array<{ code: string; message: string }>;
}

export interface InspectionDetail extends InspectionListItem {
  ledgerDigest: string;
  engineVersion: string;
  algorithmVersion: string;
  report: StoredReport;
  components: ComponentServiceRow[];
  verdicts: ModuleVerdictRow[];
  findings: FindingRow[];
  bridge: { id: string; name: string; workstation: string | null } | null;
  customer: { id: string; name: string } | null;
  reports: Array<{
    id: string;
    publicId: string;
    createdAt: string;
    sizeBytes: number;
    downloadCount: number;
  }>;
  _count: { evidence: number; inferences: number; auditEntries: number };
}

export interface EvidenceRow {
  id: string;
  evidenceId: string;
  kind: string;
  subject: string;
  key: string;
  value: string | number | boolean | null;
  sourceAuthority: string;
  method: string;
  collector: string;
  observedAt: string;
  reliability: number;
  instrument: string | null;
  raw: string | null;
  note: string | null;
}

export interface InferenceRow {
  id: string;
  inferenceId: string;
  module: ModuleId;
  rule: string;
  subject: string;
  direction: string;
  statement: string;
  weight: number;
  confidence: number;
  evidenceIds: string[];
  derivedAt: string;
}

export interface EvidenceResponse {
  ledgerDigest: string;
  evidence: EvidenceRow[];
  inferences: InferenceRow[];
}

export interface BridgeRegistration {
  id: string;
  name: string;
  workstation: string | null;
  platform: string | null;
  version: string | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  inspectionCount: number;
  online: boolean;
}

export interface PublicVerification {
  valid: true;
  reportId: string;
  issuedBy: string;
  issuedAt: string;
  checksum: string;
  evidenceLedgerDigest: string;
  device: {
    model: string;
    capacityGb: number | null;
    region: string | null;
    iosVersion: string | null;
    unitProvenance: string | null;
  };
  verdict: {
    trustVerdict: TrustVerdict;
    trustScore: number;
    rawTrustScore: number;
    confidence: number;
    coverage: number;
  };
  modules: {
    identity: string | null;
    hardware: string | null;
    security: string | null;
    battery: string | null;
  };
  battery: {
    healthPercent: number | null;
    cycleCount: number | null;
    wearGrade: string | null;
  };
  components: Array<{
    subject: string;
    verdict: ServiceVerdict;
    authenticity: PartAuthenticity;
    confidence: number;
  }>;
  notAssessed: number;
  hardwareAnomalies: number;
  evidenceCount: number;
  inferenceCount: number;
  inspectedAt: string;
  engineVersion: string;
  algorithmVersion: string;
}
