/**
 * The evidence layer.
 *
 * An `EvidenceRecord` is something DevDNA *observed*. It is never a conclusion,
 * never a score, and never an interpretation. Conclusions live in the inference
 * layer (`../inference/types.ts`) and must cite evidence by id.
 *
 * This separation is the product. A trust system that cannot show a buyer the
 * difference between "the device reported 412 cycles" and "we think the battery
 * was replaced" is just a diagnostics tool with opinions.
 */

/** What a piece of evidence is *about*. */
export enum EvidenceSubject {
  DEVICE = 'DEVICE',
  SYSTEM_SOFTWARE = 'SYSTEM_SOFTWARE',
  SECURITY_STATE = 'SECURITY_STATE',
  BATTERY = 'BATTERY',
  DISPLAY = 'DISPLAY',
  REAR_CAMERA = 'REAR_CAMERA',
  FRONT_CAMERA = 'FRONT_CAMERA',
  FACE_ID = 'FACE_ID',
  TOUCH_ID = 'TOUCH_ID',
  LOGIC_BOARD = 'LOGIC_BOARD',
  REAR_HOUSING = 'REAR_HOUSING',
  LIDAR = 'LIDAR',
  SPEAKER = 'SPEAKER',
  MICROPHONE = 'MICROPHONE',
  TAPTIC_ENGINE = 'TAPTIC_ENGINE',
}

/** Components a service verdict can be produced for. */
export const SERVICEABLE_SUBJECTS = [
  EvidenceSubject.BATTERY,
  EvidenceSubject.DISPLAY,
  EvidenceSubject.REAR_CAMERA,
  EvidenceSubject.FRONT_CAMERA,
  EvidenceSubject.FACE_ID,
  EvidenceSubject.TOUCH_ID,
  EvidenceSubject.LOGIC_BOARD,
  EvidenceSubject.REAR_HOUSING,
  EvidenceSubject.LIDAR,
  EvidenceSubject.SPEAKER,
  EvidenceSubject.MICROPHONE,
  EvidenceSubject.TAPTIC_ENGINE,
] as const;

export type ServiceableSubject = (typeof SERVICEABLE_SUBJECTS)[number];

/** The nature of the datum. */
export enum EvidenceKind {
  /** A property the operating system reports about itself or the hardware. */
  DEVICE_PROPERTY = 'DEVICE_PROPERTY',
  /** A boolean capability the platform advertises (True Tone, Face ID). */
  CAPABILITY_FLAG = 'CAPABILITY_FLAG',
  /** A numeric reading (cycle count, capacity, free space). */
  MEASUREMENT = 'MEASUREMENT',
  /** A statement about service history, from any authority. */
  SERVICE_RECORD_STATEMENT = 'SERVICE_RECORD_STATEMENT',
  /** A diagnostic event or error string recorded by the device itself. */
  DIAGNOSTIC_EVENT = 'DIAGNOSTIC_EVENT',
  /** Installed application inventory. */
  SOFTWARE_INVENTORY = 'SOFTWARE_INVENTORY',
  /** Which services the device advertised. */
  SERVICE_AVAILABILITY = 'SERVICE_AVAILABILITY',
  /**
   * A collection attempt that failed.
   *
   * Recorded as evidence, not discarded: "we asked and the device refused" is
   * exactly what justifies CANNOT_DETERMINE, and a verdict that cannot show
   * why it abstained is indistinguishable from one that never looked.
   */
  COLLECTION_FAILURE = 'COLLECTION_FAILURE',
  /** A human asserted something they read on the device. */
  HUMAN_ATTESTATION = 'HUMAN_ATTESTATION',
  /** A fact supplied by an external authority via an adapter. */
  EXTERNAL_RECORD = 'EXTERNAL_RECORD',
}

/** Which authority the datum came from. */
export enum EvidenceSource {
  DEVICE_OS = 'DEVICE_OS',
  DEVICE_HARDWARE_REGISTRY = 'DEVICE_HARDWARE_REGISTRY',
  DEVICE_ANALYTICS = 'DEVICE_ANALYTICS',
  TECHNICIAN = 'TECHNICIAN',
  OEM_SERVICE_API = 'OEM_SERVICE_API',
  REPAIR_NETWORK = 'REPAIR_NETWORK',
  DEVDNA_CATALOG = 'DEVDNA_CATALOG',
}

/** How the datum was obtained. */
export enum CollectionMethod {
  LOCKDOWN_GLOBAL_QUERY = 'LOCKDOWN_GLOBAL_QUERY',
  LOCKDOWN_DOMAIN_QUERY = 'LOCKDOWN_DOMAIN_QUERY',
  DIAGNOSTICS_RELAY_IOREGISTRY = 'DIAGNOSTICS_RELAY_IOREGISTRY',
  CRASH_REPORT_COPY = 'CRASH_REPORT_COPY',
  INSTALLATION_PROXY_LIST = 'INSTALLATION_PROXY_LIST',
  SERVICE_PROBE = 'SERVICE_PROBE',
  TECHNICIAN_INPUT = 'TECHNICIAN_INPUT',
  OCR_EXTRACTION = 'OCR_EXTRACTION',
  EXTERNAL_ADAPTER_QUERY = 'EXTERNAL_ADAPTER_QUERY',
  CATALOG_LOOKUP = 'CATALOG_LOOKUP',
}

/**
 * Where a fact came from, how, when, and how much the *channel* deserves to be
 * believed. Required on every evidence record — this is the shape the
 * Provenance Engine enforces.
 *
 * `reliability` is a property of the channel, not of the value. A perfectly
 * read number from a channel that is known to go stale still carries the
 * channel's reliability.
 */
export interface Provenance {
  source: EvidenceSource;
  method: CollectionMethod;
  /** ISO-8601. When the value was observed, not when it was processed. */
  observedAt: string;
  /** 0..1 trust in this collection channel. */
  reliability: number;
  /** Which collector produced it, e.g. `identity.lockdown`. */
  collector: string;
  /** Tool and version, where a tool was involved. Kept for reproducibility. */
  instrument?: string;
}

export type EvidenceValue = string | number | boolean | null;

/**
 * One observed fact.
 *
 * `id` is content-addressed (see `evidenceId`), so the same observation always
 * produces the same id. That gives free deduplication and makes reproducibility
 * checkable: re-collecting an unchanged device yields an identical ledger.
 */
export interface EvidenceRecord {
  id: string;
  kind: EvidenceKind;
  subject: EvidenceSubject;
  /** Stable identifier for the datum, e.g. `ProductType`, `CycleCount`. */
  key: string;
  value: EvidenceValue;
  provenance: Provenance;
  /** Verbatim excerpt that produced this record, for the audit trail. */
  raw?: string;
  /** Human-readable restatement, shown in evidence drawers. */
  note?: string;
}

/**
 * Baseline channel reliability. Deliberately conservative: an over-confident
 * channel silently inflates every downstream verdict that rests on it.
 */
export const CHANNEL_RELIABILITY: Record<CollectionMethod, number> = {
  [CollectionMethod.EXTERNAL_ADAPTER_QUERY]: 0.99,
  [CollectionMethod.LOCKDOWN_GLOBAL_QUERY]: 0.97,
  [CollectionMethod.LOCKDOWN_DOMAIN_QUERY]: 0.95,
  [CollectionMethod.CATALOG_LOOKUP]: 0.95,
  [CollectionMethod.DIAGNOSTICS_RELAY_IOREGISTRY]: 0.92,
  [CollectionMethod.INSTALLATION_PROXY_LIST]: 0.9,
  [CollectionMethod.SERVICE_PROBE]: 0.85,
  // Analytics files can be stale, partial, or absent after an erase.
  [CollectionMethod.CRASH_REPORT_COPY]: 0.72,
  [CollectionMethod.TECHNICIAN_INPUT]: 0.7,
  [CollectionMethod.OCR_EXTRACTION]: 0.6,
};

/** Why a collection attempt failed. Stored as the value of a failure record. */
export enum FailureReason {
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  NOT_PAIRED = 'NOT_PAIRED',
  DEVICE_LOCKED = 'DEVICE_LOCKED',
  TIMEOUT = 'TIMEOUT',
  UNSUPPORTED_OS = 'UNSUPPORTED_OS',
  TOOL_MISSING = 'TOOL_MISSING',
  PARSE_ERROR = 'PARSE_ERROR',
  NOT_ATTEMPTED = 'NOT_ATTEMPTED',
  UNKNOWN = 'UNKNOWN',
}
