import type { PartVerdict, Severity, VerificationStatus } from './types';

export const STATUS_LABEL: Record<VerificationStatus, string> = {
  VERIFIED: 'Verified',
  VERIFIED_WITH_NOTES: 'Verified with notes',
  CAUTION: 'Caution',
  FLAGGED: 'Flagged',
  INCONCLUSIVE: 'Inconclusive',
};

/**
 * Verdict styling. Every badge shows its wording as well as its colour —
 * a technician must never have to distinguish "genuine" from "unknown" by hue.
 */
export const STATUS_STYLE: Record<VerificationStatus, string> = {
  VERIFIED: 'bg-verified-soft text-verified border-verified/25',
  VERIFIED_WITH_NOTES: 'bg-notes-soft text-notes border-notes/25',
  CAUTION: 'bg-caution-soft text-caution border-caution/25',
  FLAGGED: 'bg-flagged-soft text-flagged border-flagged/25',
  INCONCLUSIVE: 'bg-inconclusive-soft text-inconclusive border-inconclusive/25',
};

export const VERDICT_LABEL: Record<PartVerdict, string> = {
  GENUINE_APPLE_PART: 'Genuine Apple Part',
  USED_APPLE_PART: 'Used Apple Part',
  UNKNOWN_PART: 'Unknown Part',
  UNVERIFIED_PART: 'Unverified Part',
  CANNOT_DETERMINE: 'Cannot Determine',
  NOT_APPLICABLE: 'Not Applicable',
};

export const VERDICT_STYLE: Record<PartVerdict, string> = {
  GENUINE_APPLE_PART: 'bg-verified-soft text-verified border-verified/25',
  USED_APPLE_PART: 'bg-caution-soft text-caution border-caution/25',
  UNKNOWN_PART: 'bg-flagged-soft text-flagged border-flagged/25',
  UNVERIFIED_PART: 'bg-inconclusive-soft text-inconclusive border-inconclusive/25',
  CANNOT_DETERMINE: 'bg-panel text-muted border-hairline',
  NOT_APPLICABLE: 'bg-panel text-muted border-hairline',
};

export const COMPONENT_LABEL: Record<string, string> = {
  DISPLAY: 'Display',
  BATTERY: 'Battery',
  REAR_CAMERA: 'Rear Camera',
  FRONT_CAMERA: 'Front Camera',
  FACE_ID: 'Face ID',
  TOUCH_ID: 'Touch ID',
  REAR_HOUSING: 'Rear Housing',
  LOGIC_BOARD: 'Logic Board',
  LIDAR: 'LiDAR Scanner',
  SPEAKER: 'Speaker',
  MICROPHONE: 'Microphone',
  TAPTIC_ENGINE: 'Taptic Engine',
};

export const SEVERITY_STYLE: Record<Severity, string> = {
  CRITICAL: 'text-flagged',
  HIGH: 'text-flagged',
  MEDIUM: 'text-caution',
  LOW: 'text-muted',
  INFO: 'text-muted',
};

/** Where a value came from, in words a technician recognises. */
export const SOURCE_LABEL: Record<string, string> = {
  LOCKDOWN: 'Device properties',
  LOCKDOWN_DOMAIN: 'Device properties',
  DIAGNOSTICS_RELAY: 'Diagnostics registry',
  ANALYTICS_LOG: 'Device analytics files',
  INSTALLATION_PROXY: 'Installed apps',
  SERVICE_DISCOVERY: 'Service probe',
  MOBILEGESTALT: 'Capability probe',
  TECHNICIAN_ATTESTATION: 'Technician attestation',
  ATTESTATION_OCR: 'Screenshot OCR',
  AUTHORIZED_SERVICE_API: 'Apple service API',
  DERIVED: 'Derived by DevDNA',
  SIMULATOR: 'Simulated capture',
};

export const sourceLabel = (source: string): string => SOURCE_LABEL[source] ?? source;

export const componentLabel = (component: string): string =>
  COMPONENT_LABEL[component] ?? component.replace(/_/g, ' ');

export function formatDate(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '—';
  const gb = bytes / 1000 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(bytes / 1000 ** 2)} MB`;
}

export const percent = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`;

/** Score colour for the big numerals. */
export function scoreTone(score: number): string {
  if (score >= 85) return 'text-verified';
  if (score >= 70) return 'text-notes';
  if (score >= 50) return 'text-caution';
  return 'text-flagged';
}
