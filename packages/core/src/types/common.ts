/**
 * Provenance and confidence primitives.
 *
 * Every fact DevDNA reports about a device is an *observation*, never a bare
 * value. A verification product that cannot say where a number came from, and
 * how much it should be believed, is not a verification product. Consumers of
 * this library are expected to surface `source` and `confidence` in the UI and
 * on the PDF report.
 */

/**
 * Where a piece of data physically came from. All sources listed here are
 * reachable over a standard USB trust pairing using publicly documented
 * services; none require jailbreak, exploits, or Apple-internal tooling.
 */
export enum DataSource {
  /** lockdownd global domain (`ideviceinfo`). Always available once paired. */
  LOCKDOWN = 'LOCKDOWN',
  /** lockdownd scoped domain, e.g. `com.apple.mobile.battery`, `com.apple.disk_usage`. */
  LOCKDOWN_DOMAIN = 'LOCKDOWN_DOMAIN',
  /** `com.apple.mobile.diagnostics_relay` IORegistry queries (AppleSmartBattery, ...). */
  DIAGNOSTICS_RELAY = 'DIAGNOSTICS_RELAY',
  /** Aggregated analytics / crash reports pulled over `com.apple.crashreportcopymobile`. */
  ANALYTICS_LOG = 'ANALYTICS_LOG',
  /** Installed-application inventory via `com.apple.mobile.installation_proxy`. */
  INSTALLATION_PROXY = 'INSTALLATION_PROXY',
  /** Advertised lockdown service list (used for integrity heuristics such as afc2). */
  SERVICE_DISCOVERY = 'SERVICE_DISCOVERY',
  /** MobileGestalt capability keys exposed through lockdown. */
  MOBILEGESTALT = 'MOBILEGESTALT',
  /** A human technician transcribed on-device UI (Settings > General > About). */
  TECHNICIAN_ATTESTATION = 'TECHNICIAN_ATTESTATION',
  /** OCR of a technician-supplied screenshot of the Parts & Service History screen. */
  ATTESTATION_OCR = 'ATTESTATION_OCR',
  /** Apple authorised-service-provider API (GSX). Requires an Apple AASP contract. */
  AUTHORIZED_SERVICE_API = 'AUTHORIZED_SERVICE_API',
  /** Derived by DevDNA from one or more of the above. */
  DERIVED = 'DERIVED',
  /** Deterministic simulator used for development, demos and automated tests. */
  SIMULATOR = 'SIMULATOR',
}

/**
 * Baseline trustworthiness of each source, before per-observation adjustment.
 * Used when a fact is available from several places and we must pick a winner.
 */
export const SOURCE_BASE_CONFIDENCE: Record<DataSource, number> = {
  [DataSource.AUTHORIZED_SERVICE_API]: 1.0,
  [DataSource.LOCKDOWN]: 0.98,
  [DataSource.LOCKDOWN_DOMAIN]: 0.95,
  [DataSource.DIAGNOSTICS_RELAY]: 0.92,
  [DataSource.MOBILEGESTALT]: 0.9,
  [DataSource.INSTALLATION_PROXY]: 0.9,
  [DataSource.SERVICE_DISCOVERY]: 0.85,
  [DataSource.ANALYTICS_LOG]: 0.72,
  [DataSource.TECHNICIAN_ATTESTATION]: 0.7,
  [DataSource.ATTESTATION_OCR]: 0.6,
  [DataSource.DERIVED]: 0.8,
  [DataSource.SIMULATOR]: 0.5,
};

/** A single observed value together with its provenance. */
export interface Observation<T> {
  value: T;
  source: DataSource;
  /** 0..1 — how much this specific reading should be believed. */
  confidence: number;
  /** ISO-8601 timestamp of collection. */
  observedAt: string;
  /** Human-readable explanation shown in the evidence drawer of the UI. */
  note?: string;
}

export type MaybeObservation<T> = Observation<T> | null;

export enum Severity {
  INFO = 'INFO',
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

/** A machine-readable finding attached to an inspection. */
export interface Finding {
  code: string;
  severity: Severity;
  title: string;
  detail: string;
  source: DataSource;
}

/** Why a value could not be collected. Surfaced verbatim to technicians. */
export interface CollectionError {
  /** The collector that failed, e.g. `battery.ioregistry`. */
  collector: string;
  code: CollectionErrorCode;
  message: string;
}

export enum CollectionErrorCode {
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  NOT_PAIRED = 'NOT_PAIRED',
  DEVICE_LOCKED = 'DEVICE_LOCKED',
  TIMEOUT = 'TIMEOUT',
  UNSUPPORTED_OS = 'UNSUPPORTED_OS',
  TOOL_MISSING = 'TOOL_MISSING',
  PARSE_ERROR = 'PARSE_ERROR',
  UNKNOWN = 'UNKNOWN',
}

export const clamp = (value: number, min = 0, max = 100): number =>
  Math.min(max, Math.max(min, value));

export const round = (value: number, dp = 0): number => {
  const f = 10 ** dp;
  return Math.round(value * f) / f;
};

/** Linear interpolation between two calibration points. */
export const lerp = (x: number, x0: number, x1: number, y0: number, y1: number): number => {
  if (x1 === x0) return y0;
  return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
};

export const observe = <T>(
  value: T,
  source: DataSource,
  opts: { confidence?: number; observedAt?: string; note?: string } = {},
): Observation<T> => ({
  value,
  source,
  confidence: opts.confidence ?? SOURCE_BASE_CONFIDENCE[source],
  observedAt: opts.observedAt ?? new Date().toISOString(),
  ...(opts.note ? { note: opts.note } : {}),
});
