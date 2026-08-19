import type { Finding } from './common.js';
import type { BatteryAssessment } from './battery.js';
import type { DeviceIdentity } from './device.js';
import type { PartsAssessment } from './parts.js';
import type { SoftwareAssessment } from './software.js';

export enum VerificationStatus {
  /** High score, high confidence — safe to trade. */
  VERIFIED = 'VERIFIED',
  /** Sound device with disclosed caveats (used part, ageing battery). */
  VERIFIED_WITH_NOTES = 'VERIFIED_WITH_NOTES',
  /** Material issues found; price accordingly. */
  CAUTION = 'CAUTION',
  /** Non-genuine critical part, activation lock, or integrity failure. */
  FLAGGED = 'FLAGGED',
  /** Too little evidence to make any claim. Never presented as a pass. */
  INCONCLUSIVE = 'INCONCLUSIVE',
}

/** A cap applied to the trust score by a hard rule, with its justification. */
export interface TrustGate {
  code: string;
  cap: number;
  reason: string;
}

export interface TrustAssessment {
  /** 0-100 final trust score after gates. */
  score: number;
  /** Score before gates were applied — shown to technicians for transparency. */
  rawScore: number;
  /** 0-1 aggregate confidence across all contributing engines. */
  confidence: number;
  status: VerificationStatus;
  inputs: {
    battery: { score: number; confidence: number; weight: number };
    software: { score: number; confidence: number; weight: number };
    parts: { score: number; confidence: number; weight: number };
  };
  /** Gates that were evaluated and fired. */
  gatesApplied: TrustGate[];
  /** Algorithm version, persisted so historical reports stay reproducible. */
  algorithmVersion: string;
}

export interface InspectionResult {
  /** Engine bundle version used to produce this result. */
  engineVersion: string;
  inspectedAt: string;
  identity: DeviceIdentity;
  battery: BatteryAssessment;
  software: SoftwareAssessment;
  parts: PartsAssessment;
  trust: TrustAssessment;
  /** All findings from all engines, deduplicated and severity-sorted. */
  findings: Finding[];
}
