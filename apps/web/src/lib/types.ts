/** Shapes returned by the DevDNA API, as consumed by the dashboard. */

export type VerificationStatus =
  | 'VERIFIED'
  | 'VERIFIED_WITH_NOTES'
  | 'CAUTION'
  | 'FLAGGED'
  | 'INCONCLUSIVE';

export type PartVerdict =
  | 'GENUINE_APPLE_PART'
  | 'USED_APPLE_PART'
  | 'UNKNOWN_PART'
  | 'UNVERIFIED_PART'
  | 'CANNOT_DETERMINE'
  | 'NOT_APPLICABLE';

export type Severity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface DashboardSummary {
  windowDays: number;
  totals: {
    inspections: number;
    inspectionsInWindow: number;
    devices: number;
    verified: number;
    flagged: number;
    inconclusive: number;
  };
  averages: {
    trustScore: number | null;
    batteryScore: number | null;
    softwareScore: number | null;
    partsScore: number | null;
    confidence: number | null;
  };
  statusBreakdown: Record<string, number>;
  partBreakdown: Array<{ component: string; verdict: PartVerdict; count: number }>;
  topFindings: Array<{ code: string; severity: Severity; count: number }>;
  recent: Array<{
    id: string;
    createdAt: string;
    trustScore: number;
    verificationStatus: VerificationStatus;
    device: { marketingName: string; capacityGb: number | null };
    user: { name: string } | null;
  }>;
}

export interface InspectionListItem {
  id: string;
  createdAt: string;
  capturedAt: string;
  trustScore: number;
  verificationStatus: VerificationStatus;
  batteryScore: number;
  softwareScore: number;
  partsScore: number;
  confidence: number;
  batteryHealthPercent: number | null;
  batteryCycleCount: number | null;
  iosVersion: string | null;
  reportCount: number;
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

export interface PartResultRecord {
  id: string;
  component: string;
  verdict: PartVerdict;
  confidence: number;
  weight: number;
  rationale: string;
}

export interface FindingRecord {
  id: string;
  code: string;
  severity: Severity;
  title: string;
  detail: string;
  source: string;
}

export interface InspectionDetail extends InspectionListItem {
  rawTrustScore: number;
  partsCoverage: number;
  engineVersion: string;
  algorithmVersion: string;
  buildVersion: string | null;
  partResults: PartResultRecord[];
  findings: FindingRecord[];
  bridge: { id: string; name: string; workstation: string | null } | null;
  customer: { id: string; name: string } | null;
  reports: Array<{
    id: string;
    publicId: string;
    createdAt: string;
    sizeBytes: number;
    downloadCount: number;
  }>;
  /** The full engine output, as stored at inspection time. */
  result: {
    identity: Record<string, unknown> & {
      marketingName: string;
      productType: string;
      marketingCapacityGb: number | null;
      regionName: string | null;
      iosVersion: string | null;
      buildVersion: string | null;
      modelNumber: string | null;
      serialNumber: string | null;
      imei: string | null;
      recognisedModel: boolean;
      activation: {
        state: string | null;
        activated: boolean;
        activationLockEnabled: boolean | null;
        supervised: boolean | null;
        mdmEnrolled: boolean | null;
        passcodeSet: boolean | null;
      };
    };
    battery: {
      score: number;
      confidence: number;
      condition: string;
      chargingState: string;
      ratedCycleLife: number;
      maximumCapacityPercent: { value: number; source: string; confidence: number } | null;
      cycleCount: { value: number; source: string; confidence: number } | null;
      currentChargePercent: { value: number; source: string } | null;
      designCapacityMah: { value: number } | null;
      nominalChargeCapacityMah: { value: number } | null;
      breakdown: { healthComponent: number | null; cycleComponent: number | null };
    };
    software: {
      score: number;
      confidence: number;
      iosVersion: string | null;
      latestKnownVersion: string | null;
      majorVersionsBehind: number | null;
      diagnosticsAvailable: boolean;
      jailbreakSuspected: boolean;
      jailbreakIndicators: string[];
      storage: { totalBytes: number | null; availableBytes: number | null; usedPercent: number | null };
    };
    parts: {
      score: number;
      confidence: number;
      coverage: number;
      attestationPresent: boolean;
      results: Array<{
        component: string;
        verdict: PartVerdict;
        confidence: number;
        rationale: string;
        signals: Array<{
          id: string;
          summary: string;
          source: string;
          strength: number;
          confidence: number;
          polarity: string;
          evidence?: string;
        }>;
      }>;
    };
    trust: {
      score: number;
      rawScore: number;
      confidence: number;
      status: VerificationStatus;
      gatesApplied: Array<{ code: string; cap: number; reason: string }>;
      inputs: Record<string, { score: number; confidence: number; weight: number }>;
    };
  };
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
  device: {
    model: string;
    capacityGb: number | null;
    region: string | null;
    iosVersion: string | null;
  };
  verdict: {
    trustScore: number;
    status: VerificationStatus;
    confidence: number;
    batteryScore: number;
    softwareScore: number;
    partsScore: number;
    batteryHealthPercent: number | null;
    batteryCycleCount: number | null;
  };
  parts: Array<{ component: string; verdict: PartVerdict; confidence: number }>;
  inspectedAt: string;
  engineVersion: string;
}
