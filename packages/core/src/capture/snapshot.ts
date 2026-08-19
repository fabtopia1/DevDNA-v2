import { FailureReason } from '../evidence/types.js';

/**
 * The capture layer.
 *
 * A `RawDeviceSnapshot` is the wire format between the DevDNA Bridge and the
 * cloud. It is deliberately dumb: it carries what the tools returned, with no
 * interpretation whatsoever.
 *
 * Nothing downstream of `collectEvidence()` reads this type. Modules read the
 * evidence ledger, which is what makes a stored inspection reproducible without
 * the original capture.
 */
export interface RawDeviceSnapshot {
  /** Bumped whenever collector output changes shape. */
  schemaVersion: 1;
  capturedAt: string;
  bridge: {
    version: string;
    platform: 'darwin' | 'win32' | 'linux';
    /** libimobiledevice tool versions actually used, for reproducibility. */
    toolchain: Record<string, string>;
    mode: 'usb' | 'simulator';
  };
  /** Global lockdown domain key/value pairs. */
  lockdown: Record<string, unknown>;
  /** Scoped lockdown domains keyed by domain name. */
  domains: Record<string, Record<string, unknown>>;
  /** Raw IORegistry entries keyed by class, e.g. `AppleSmartBattery`. */
  ioregistry: Record<string, Record<string, unknown>>;
  /** Extracted keys from aggregated analytics files. */
  analytics: AnalyticsExtract | null;
  /** Bundle identifiers of user-installed applications. */
  installedApps: string[];
  /** lockdown services the device advertised. */
  services: string[];
  /** Technician-supplied Parts & Service History attestation, if captured. */
  attestation: ServiceHistoryAttestation | null;
  errors: CollectionError[];
}

/** Battery-relevant fields harvested from `log-aggregated-*.ips` analytics files. */
export interface AnalyticsExtract {
  sourceFile: string;
  fileDate: string | null;
  batteryKeys: Record<string, number | string | boolean>;
  /** Diagnostic strings matched by the service evidence rules. */
  diagnosticStrings: string[];
}

/** A collection attempt that failed. Carried into the ledger as evidence. */
export interface CollectionError {
  /** The collector that failed, e.g. `battery.ioregistry`. */
  collector: string;
  code: FailureReason;
  message: string;
}

/**
 * What Settings > General > About > Parts and Service History showed, as
 * transcribed by a technician.
 *
 * Note carefully: iOS renders this section **only when a service record
 * exists**. A component appearing here at all is evidence that it was
 * serviced, whatever label it carries. See `modules/service.ts`.
 */
export interface ServiceHistoryAttestation {
  capturedBy: string;
  capturedAt: string;
  method: 'MANUAL' | 'OCR';
  /** Component name as rendered by iOS, with its exact label. */
  entries: Array<{ component: string; label: AppleServiceHistoryLabel }>;
  /** Set when iOS renders no Parts & Service History section at all. */
  sectionAbsent?: boolean;
}

/** The exact strings iOS renders on the Parts and Service History screen. */
export enum AppleServiceHistoryLabel {
  GENUINE_APPLE_PART = 'Genuine Apple Part',
  UNKNOWN_PART = 'Unknown Part',
  USED_APPLE_PART = 'Used Apple Part',
  UNABLE_TO_VERIFY = 'Unable to verify this part is a genuine Apple part',
}

export { FailureReason };
