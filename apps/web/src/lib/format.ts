import type {
  Determinacy,
  FindingBasis,
  ModuleId,
  PartAuthenticity,
  ServiceVerdict,
  Severity,
  TrustVerdict,
} from './types';

export const TRUST_LABEL: Record<TrustVerdict, string> = {
  TRUSTED: 'Trusted',
  TRUSTED_WITH_NOTES: 'Trusted with notes',
  CAUTION: 'Caution',
  UNTRUSTED: 'Untrusted',
  INSUFFICIENT_EVIDENCE: 'Insufficient evidence',
};

/**
 * Verdict styling.
 *
 * Every badge shows its wording as well as its colour. A technician must never
 * have to distinguish "original" from "replaced" by hue, and the palette stays
 * legible under common colour vision deficiencies.
 */
export const TRUST_STYLE: Record<TrustVerdict, string> = {
  TRUSTED: 'bg-verified-soft text-verified border-verified/25',
  TRUSTED_WITH_NOTES: 'bg-notes-soft text-notes border-notes/25',
  CAUTION: 'bg-caution-soft text-caution border-caution/25',
  UNTRUSTED: 'bg-flagged-soft text-flagged border-flagged/25',
  INSUFFICIENT_EVIDENCE: 'bg-inconclusive-soft text-inconclusive border-inconclusive/25',
};

export const SERVICE_LABEL: Record<ServiceVerdict, string> = {
  ORIGINAL_LIKELY: 'Original likely',
  REPLACED_LIKELY: 'Replaced likely',
  CANNOT_DETERMINE: 'Cannot determine',
};

export const SERVICE_STYLE: Record<ServiceVerdict, string> = {
  ORIGINAL_LIKELY: 'bg-verified-soft text-verified border-verified/25',
  REPLACED_LIKELY: 'bg-caution-soft text-caution border-caution/25',
  CANNOT_DETERMINE: 'bg-panel text-muted border-hairline',
};

export const AUTHENTICITY_LABEL: Record<PartAuthenticity, string> = {
  GENUINE_APPLE: 'Genuine Apple part',
  GENUINE_TRANSPLANTED: 'Genuine part, another device',
  NOT_VERIFIED: 'Not verified by Apple',
  UNKNOWN: 'Authenticity unknown',
};

export const AUTHENTICITY_STYLE: Record<PartAuthenticity, string> = {
  GENUINE_APPLE: 'bg-verified-soft text-verified border-verified/25',
  GENUINE_TRANSPLANTED: 'bg-caution-soft text-caution border-caution/25',
  NOT_VERIFIED: 'bg-flagged-soft text-flagged border-flagged/25',
  UNKNOWN: 'bg-panel text-muted border-hairline',
};

export const MODULE_LABEL: Record<ModuleId, string> = {
  IDENTITY: 'Identity',
  HARDWARE_CONSISTENCY: 'Hardware consistency',
  SERVICE_EVIDENCE: 'Service evidence',
  BATTERY_INTELLIGENCE: 'Battery intelligence',
  SECURITY_DNA: 'SecurityDNA',
  TRUST: 'Trust',
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
  DEVICE: 'Device',
  SYSTEM_SOFTWARE: 'System software',
  SECURITY_STATE: 'Security state',
};

export const SEVERITY_STYLE: Record<Severity, string> = {
  CRITICAL: 'text-flagged',
  HIGH: 'text-flagged',
  MEDIUM: 'text-caution',
  LOW: 'text-muted',
  INFO: 'text-muted',
};

/** Which authority a fact came from, in words a technician recognises. */
export const SOURCE_LABEL: Record<string, string> = {
  DEVICE_OS: 'Device operating system',
  DEVICE_HARDWARE_REGISTRY: 'Hardware registry',
  DEVICE_ANALYTICS: 'Device analytics files',
  TECHNICIAN: 'Technician attestation',
  OEM_SERVICE_API: 'Manufacturer service records',
  REPAIR_NETWORK: 'Repair network',
  DEVDNA_CATALOG: 'DevDNA catalog',
};

/** How a fact was obtained. */
export const METHOD_LABEL: Record<string, string> = {
  LOCKDOWN_GLOBAL_QUERY: 'Device property query',
  LOCKDOWN_DOMAIN_QUERY: 'Scoped property query',
  DIAGNOSTICS_RELAY_IOREGISTRY: 'Diagnostics registry',
  CRASH_REPORT_COPY: 'Analytics file harvest',
  INSTALLATION_PROXY_LIST: 'Installed app inventory',
  SERVICE_PROBE: 'Service probe',
  TECHNICIAN_INPUT: 'Typed by technician',
  OCR_EXTRACTION: 'Screenshot OCR',
  EXTERNAL_ADAPTER_QUERY: 'External authority',
  CATALOG_LOOKUP: 'Catalog lookup',
};

export const EVIDENCE_KIND_LABEL: Record<string, string> = {
  DEVICE_PROPERTY: 'Property',
  CAPABILITY_FLAG: 'Capability',
  MEASUREMENT: 'Measurement',
  SERVICE_RECORD_STATEMENT: 'Service record',
  DIAGNOSTIC_EVENT: 'Diagnostic event',
  SOFTWARE_INVENTORY: 'Software inventory',
  SERVICE_AVAILABILITY: 'Service availability',
  COLLECTION_FAILURE: 'Collection failure',
  HUMAN_ATTESTATION: 'Human attestation',
  EXTERNAL_RECORD: 'External record',
};

export const UNIT_PROVENANCE_LABEL: Record<string, string> = {
  RETAIL: 'Retail unit',
  APPLE_REFURBISHED: 'Apple refurbished',
  SERVICE_REPLACEMENT: 'Service replacement',
  PERSONALISED: 'Retail (personalised)',
  DEMO: 'Demonstration unit',
  UNKNOWN: 'Not determinable',
};

export const BASIS_LABEL: Record<FindingBasis, string> = {
  EVIDENCE: 'Evidence-based',
  ABSENCE: 'Based on absent evidence',
};

export const sourceLabel = (source: string): string => SOURCE_LABEL[source] ?? source;
export const methodLabel = (method: string): string => METHOD_LABEL[method] ?? method;
export const kindLabel = (kind: string): string => EVIDENCE_KIND_LABEL[kind] ?? kind;
export const componentLabel = (subject: string): string =>
  COMPONENT_LABEL[subject] ?? subject.replace(/_/g, ' ');
export const moduleLabel = (module: ModuleId): string => MODULE_LABEL[module] ?? module;
export const unitProvenanceLabel = (value: string | null): string =>
  value ? (UNIT_PROVENANCE_LABEL[value] ?? value) : '—';

/** A module verdict rendered for a technician, not for a machine. */
export const verdictLabel = (value: string | null): string =>
  value ? value.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : '—';

export const determinacyLabel = (determinacy: Determinacy): string =>
  determinacy === 'DETERMINED' ? 'Determined' : 'Indeterminate';

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

export function confidenceTone(confidence: number): string {
  if (confidence >= 0.8) return 'text-verified';
  if (confidence >= 0.6) return 'text-notes';
  if (confidence >= 0.45) return 'text-caution';
  return 'text-flagged';
}

/** Reliability rendered as words; a bare decimal means nothing to a shop. */
export function reliabilityLabel(reliability: number): string {
  if (reliability >= 0.95) return 'very high';
  if (reliability >= 0.85) return 'high';
  if (reliability >= 0.7) return 'moderate';
  return 'low';
}
