import type { CollectionError, Observation } from './common.js';

/**
 * Raw, un-interpreted capture from the DevDNA Bridge. This is the wire format
 * between the local agent and the cloud engine, and is stored verbatim so that
 * any inspection can be re-scored later when the engines improve.
 */
export interface RawDeviceSnapshot {
  /** Snapshot schema version — bumped whenever collector output changes shape. */
  schemaVersion: 1;
  capturedAt: string;
  bridge: {
    version: string;
    platform: 'darwin' | 'win32' | 'linux';
    /** `libimobiledevice` tool versions actually used, for reproducibility. */
    toolchain: Record<string, string>;
    mode: 'usb' | 'simulator';
  };
  /** Global lockdown domain key/value pairs (`ideviceinfo`). */
  lockdown: Record<string, unknown>;
  /** Scoped lockdown domains keyed by domain name. */
  domains: Record<string, Record<string, unknown>>;
  /** Raw IORegistry entries keyed by class, e.g. `AppleSmartBattery`. */
  ioregistry: Record<string, Record<string, unknown>>;
  /** Extracted battery keys from aggregated analytics files. */
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
  /** Free-form diagnostic strings matched by the parts signal rules. */
  diagnosticStrings: string[];
}

/**
 * What Settings > General > About > Parts and Service History shows, as
 * transcribed by a technician. Apple only renders this screen for components it
 * has a service record or pairing state for.
 */
export interface ServiceHistoryAttestation {
  capturedBy: string;
  capturedAt: string;
  method: 'MANUAL' | 'OCR';
  /** Component key -> exact label rendered by iOS. */
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

/** Normalised, human-facing device identity. */
export interface DeviceIdentity {
  /** `iPhone15,2` */
  productType: string;
  /** `iPhone 14 Pro` — resolved from the catalog; falls back to productType. */
  marketingName: string;
  /** True when the catalog recognised the product type. */
  recognisedModel: boolean;
  deviceName: string | null;
  /** `D73AP` */
  hardwareModel: string | null;
  /** `MQ0G3` */
  modelNumber: string | null;
  /** `LL/A` */
  regionCode: string | null;
  regionName: string | null;
  /** Bytes as reported by the device. */
  totalDiskCapacityBytes: number | null;
  /** Marketing capacity in GB (128, 256, ...) inferred from raw bytes. */
  marketingCapacityGb: number | null;
  udid: string;
  /** SHA-256 of the UDID; what we persist by default (see security architecture). */
  udidHash: string;
  serialNumber: string | null;
  imei: string | null;
  meid: string | null;
  eid: string | null;
  iosVersion: string | null;
  buildVersion: string | null;
  deviceClass: string | null;
  cpuArchitecture: string | null;
  activation: ActivationSummary;
  releaseYear: number | null;
}

export interface ActivationSummary {
  /** `Activated`, `Unactivated`, `FactoryActivated`, ... */
  state: string | null;
  activated: boolean;
  /** Activation Lock / Find My. Null when it could not be determined. */
  activationLockEnabled: boolean | null;
  /** Device is supervised by an MDM — a resale blocker. */
  supervised: boolean | null;
  /** Enrolled in a mobile device management profile. */
  mdmEnrolled: boolean | null;
  passcodeSet: boolean | null;
}

export interface IdentityAssessment {
  identity: DeviceIdentity;
  observations: Record<string, Observation<unknown>>;
}
