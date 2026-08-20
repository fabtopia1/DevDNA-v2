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
  /**
   * Physical surfaces, added for PhysicalDNA.
   *
   * Note what is *not* here: front glass and rear glass do not get their own
   * subjects, because they are the outward faces of DISPLAY and REAR_HOUSING,
   * which already exist. Keeping them as one subject is what lets a report say
   * "display: REPLACED_LIKELY (service evidence), CONDITION_FAIR (physical)" -
   * two modules answering two different questions about the same part, rather
   * than two vocabularies that can never be joined.
   */
  FRAME = 'FRAME',
  CHARGE_PORT = 'CHARGE_PORT',
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
  /**
   * Something seen in a photograph of the device.
   *
   * A detection is an *observation*, not a judgement: "a region matching the
   * DEEP_SCRATCH class was located at these coordinates in this image, by this
   * model version". Whether that makes the device Fair or Good is an inference,
   * derived later and citing this record.
   */
  VISUAL_OBSERVATION = 'VISUAL_OBSERVATION',
  /** A measured property of a captured image (sharpness, exposure, glare). */
  IMAGE_QUALITY_METRIC = 'IMAGE_QUALITY_METRIC',
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
  /** DevDNA's own defect detection model. Named with its version on every record. */
  DEVDNA_VISION_MODEL = 'DEVDNA_VISION_MODEL',
  /** DevDNA's guided capture and image validation pipeline. */
  DEVDNA_CAPTURE_PIPELINE = 'DEVDNA_CAPTURE_PIPELINE',
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
  VISION_MODEL_DETECTION = 'VISION_MODEL_DETECTION',
  IMAGE_QUALITY_ANALYSIS = 'IMAGE_QUALITY_ANALYSIS',
  GUIDED_PHOTO_CAPTURE = 'GUIDED_PHOTO_CAPTURE',
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
  // Deterministic arithmetic over pixels. Reliable as a *measurement*; whether
  // the threshold it is compared against is the right one is a separate matter.
  [CollectionMethod.IMAGE_QUALITY_ANALYSIS]: 0.97,
  [CollectionMethod.DIAGNOSTICS_RELAY_IOREGISTRY]: 0.92,
  [CollectionMethod.INSTALLATION_PROXY_LIST]: 0.9,
  [CollectionMethod.SERVICE_PROBE]: 0.85,
  // That a photograph is of the view it claims to be. Guided capture makes this
  // likely, not certain: a technician can photograph the wrong edge.
  [CollectionMethod.GUIDED_PHOTO_CAPTURE]: 0.9,
  /*
   * Baseline only, and deliberately low.
   *
   * Every real detection overrides this with the *calibrated* reliability for
   * its class, measured as held-out precision on the benchmark set - never the
   * model's own softmax score. A network's confidence is a statement about its
   * activation, not about the world, and a system that treats the two as the
   * same thing is exactly the black box this architecture exists to avoid.
   *
   * This value is what an *uncalibrated* class falls back to, and it is set
   * where it is so that shipping a class without calibrating it visibly costs
   * confidence rather than silently borrowing it.
   */
  [CollectionMethod.VISION_MODEL_DETECTION]: 0.75,
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
