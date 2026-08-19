import type { DataSource, Finding } from './common.js';

/**
 * Components DevDNA can hold an opinion about. The list is intentionally open
 * for extension: Apple adds components to Parts & Service History with new iOS
 * releases, and the rule engine is data-driven so new components need no code
 * change beyond a catalog entry.
 */
export enum PartComponent {
  DISPLAY = 'DISPLAY',
  BATTERY = 'BATTERY',
  REAR_CAMERA = 'REAR_CAMERA',
  FRONT_CAMERA = 'FRONT_CAMERA',
  FACE_ID = 'FACE_ID',
  TOUCH_ID = 'TOUCH_ID',
  REAR_HOUSING = 'REAR_HOUSING',
  LOGIC_BOARD = 'LOGIC_BOARD',
  LIDAR = 'LIDAR',
  SPEAKER = 'SPEAKER',
  MICROPHONE = 'MICROPHONE',
  TAPTIC_ENGINE = 'TAPTIC_ENGINE',
}

/**
 * Verdict vocabulary. `GENUINE_APPLE_PART`, `USED_APPLE_PART` and
 * `UNKNOWN_PART` mirror Apple's own on-device wording so technicians see
 * language they already recognise.
 */
export enum PartVerdict {
  /** Apple part, paired to this device, never serviced elsewhere. */
  GENUINE_APPLE_PART = 'GENUINE_APPLE_PART',
  /** Authentic Apple part previously installed in a different device. */
  USED_APPLE_PART = 'USED_APPLE_PART',
  /** Positively identified as non-genuine or unpairable. */
  UNKNOWN_PART = 'UNKNOWN_PART',
  /** Signals exist but are too weak or conflicting to conclude. */
  UNVERIFIED_PART = 'UNVERIFIED_PART',
  /** No signal at all is obtainable for this component on this device/OS. */
  CANNOT_DETERMINE = 'CANNOT_DETERMINE',
  /** The component does not exist on this model (e.g. Face ID on an SE). */
  NOT_APPLICABLE = 'NOT_APPLICABLE',
}

/** Score contribution of each verdict, 0-100. */
export const VERDICT_SCORE: Record<PartVerdict, number | null> = {
  [PartVerdict.GENUINE_APPLE_PART]: 100,
  [PartVerdict.USED_APPLE_PART]: 72,
  [PartVerdict.UNVERIFIED_PART]: 55,
  [PartVerdict.UNKNOWN_PART]: 12,
  /** null => excluded from the weighted mean, counted against coverage. */
  [PartVerdict.CANNOT_DETERMINE]: null,
  [PartVerdict.NOT_APPLICABLE]: null,
};

export enum SignalPolarity {
  /** Supports the component being genuine and originally paired. */
  SUPPORTS_GENUINE = 'SUPPORTS_GENUINE',
  /** Supports an authentic-but-transplanted component. */
  SUPPORTS_USED = 'SUPPORTS_USED',
  /** Supports a non-genuine component. */
  SUPPORTS_UNKNOWN = 'SUPPORTS_UNKNOWN',
  /** Indicates service activity without identifying the part's origin. */
  SUPPORTS_SERVICED = 'SUPPORTS_SERVICED',
}

/**
 * One piece of evidence about one component. Signals are produced by
 * independent detectors and consumed by the rule engine, so a new detector can
 * be added without touching verdict logic.
 */
export interface PartSignal {
  id: string;
  component: PartComponent;
  polarity: SignalPolarity;
  source: DataSource;
  /** 0-1 how strongly this evidence points in its polarity's direction. */
  strength: number;
  /** 0-1 how reliable the reading itself is. */
  confidence: number;
  summary: string;
  /** Raw value that triggered the detector, kept for the audit trail. */
  evidence?: string;
}

export interface PartResult {
  component: PartComponent;
  verdict: PartVerdict;
  /** 0-1 confidence in this verdict. */
  confidence: number;
  /** Weight of this component within the parts score. */
  weight: number;
  signals: PartSignal[];
  /** One-line technician-facing explanation of how the verdict was reached. */
  rationale: string;
}

export interface PartsAssessment {
  results: PartResult[];
  /** 0-100 weighted authenticity score across determinable components. */
  score: number;
  /** 0-1 confidence in the parts score. */
  confidence: number;
  /** Share of applicable component weight that produced a verdict. */
  coverage: number;
  /** True when Apple's own service-history screen was transcribed. */
  attestationPresent: boolean;
  findings: Finding[];
}
