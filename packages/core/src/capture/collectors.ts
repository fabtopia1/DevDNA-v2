import { EvidenceLedger } from '../evidence/ledger.js';
import {
  CollectionMethod,
  EvidenceKind,
  EvidenceSource,
  EvidenceSubject,
  FailureReason,
  type EvidenceValue,
} from '../evidence/types.js';
import { asBoolean, asNumber, asString, pick } from '../parsers/ideviceinfo.js';
import { parseSmartBattery } from '../parsers/ioregistry.js';
import { hardwareSpecFor } from '../catalog/hardware-specs.js';
import { resolveDevice } from '../catalog/devices.js';
import { AppleServiceHistoryLabel, type RawDeviceSnapshot } from './snapshot.js';

/**
 * Snapshot to evidence.
 *
 * This is the only place in the system that reads a `RawDeviceSnapshot`. Its
 * single job is translation: every value the bridge captured becomes an
 * evidence record with full provenance, and nothing is interpreted, scored or
 * discarded on the way.
 *
 * Failures are translated too. "The diagnostics relay refused" is a record in
 * the ledger, because that is precisely what later justifies a
 * CANNOT_DETERMINE verdict, and a verdict that cannot show why it abstained is
 * indistinguishable from one that never looked.
 */

/** Lockdown keys that describe the device itself. */
const DEVICE_KEYS = [
  'ProductType',
  'HardwareModel',
  'ModelNumber',
  'RegionInfo',
  'DeviceClass',
  'CPUArchitecture',
  'SerialNumber',
  'UniqueDeviceID',
  'UniqueChipID',
  'InternationalMobileEquipmentIdentity',
  'InternationalMobileEquipmentIdentity2',
  'MobileEquipmentIdentifier',
  'DeviceName',
  'TotalDiskCapacity',
  'DeviceColor',
  'DeviceEnclosureColor',
] as const;

/** Lockdown keys that describe the operating system. */
const SOFTWARE_KEYS = ['ProductVersion', 'BuildVersion', 'ProductName'] as const;

/** Lockdown keys that describe security posture. */
const SECURITY_KEYS = [
  'ActivationState',
  'PasswordProtected',
  'DeveloperModeStatus',
  'DeveloperMode',
] as const;

/**
 * Provenance timestamps must be full instants.
 *
 * Analytics files name themselves with a date only (`2026-03-11`), and letting
 * that through as `observedAt` meant the value did not survive a round-trip
 * through a timestamp column: the ledger digest changed on reload and genuine
 * tampering became indistinguishable from a formatting artefact.
 */
function toInstant(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

interface CollectorContext {
  ledger: EvidenceLedger;
  at: string;
  instrument: string;
}

export function collectEvidence(snapshot: RawDeviceSnapshot): EvidenceLedger {
  const ledger = new EvidenceLedger();
  const context: CollectorContext = {
    ledger,
    at: toInstant(snapshot.capturedAt, new Date().toISOString()),
    instrument: `devdna-bridge/${snapshot.bridge.version}`,
  };

  collectLockdown(context, snapshot);
  collectCatalogExpectations(context, snapshot);
  collectDomains(context, snapshot);
  collectBatteryRegistry(context, snapshot);
  collectAnalytics(context, snapshot);
  collectSoftwareInventory(context, snapshot);
  collectServiceAvailability(context, snapshot);
  collectAttestation(context, snapshot);
  collectFailures(context, snapshot);

  return ledger;
}


/**
 * Seed the catalog's expectations for the detected model.
 *
 * These are written during collection rather than by the modules that use them,
 * for two reasons.
 *
 * First, correctness: a module that appended to the ledger while reading it
 * made evaluation non-idempotent - the same ledger evaluated twice produced
 * different audit trails, and a re-scored ledger diverged from the original.
 * Modules are pure readers now, so `evaluate` is a function of the ledger alone.
 *
 * Second, honesty: an expectation is a claim DevDNA makes, not a fact the
 * device reported. Recording it with `DEVDNA_CATALOG` provenance means every
 * anomaly can cite both the observed value and the expectation it was judged
 * against, so a technician can dispute our catalog rather than an opaque
 * verdict.
 *
 * An uncatalogued model seeds nothing, and the modules abstain rather than
 * comparing against a fabricated baseline.
 */
function collectCatalogExpectations(ctx: CollectorContext, snapshot: RawDeviceSnapshot): void {
  const productType = asString(pick(snapshot.lockdown, 'ProductType'));
  if (!productType) return;

  const spec = hardwareSpecFor(productType);
  const device = resolveDevice(productType);

  const expectation = (
    subject: EvidenceSubject,
    key: string,
    value: EvidenceValue,
    note?: string,
  ): void => {
    ctx.ledger.record({
      kind: EvidenceKind.DEVICE_PROPERTY,
      subject,
      key,
      value,
      source: EvidenceSource.DEVDNA_CATALOG,
      method: CollectionMethod.CATALOG_LOOKUP,
      collector: 'catalog.expectations',
      observedAt: ctx.at,
      ...(note ? { note } : {}),
    });
  };

  if (spec) {
    expectation(
      EvidenceSubject.DEVICE,
      'ExpectedBoardIds',
      spec.boardIds.join(','),
      `Board identifiers Apple shipped for ${spec.productType}`,
    );
    expectation(EvidenceSubject.DEVICE, 'ExpectedCapacitiesGb', spec.capacitiesGb.join(','));
    expectation(
      EvidenceSubject.DEVICE,
      'ExpectedCpuArchitecture',
      spec.cpuArchitecture,
      `${spec.productType} uses the ${spec.chip}`,
    );
    expectation(EvidenceSubject.DEVICE, 'ExpectedSerialFormats', spec.expectedSerialFormats.join(','));
    expectation(EvidenceSubject.DEVICE, 'ExpectedUdidFormat', spec.expectedUdidFormat);
    expectation(
      EvidenceSubject.BATTERY,
      'ExpectedDesignCapacity',
      spec.designCapacityMah,
      `Design capacity of the original ${spec.productType} cell`,
    );
  }

  if (device.recognised) {
    expectation(
      EvidenceSubject.BATTERY,
      'RatedCycleLife',
      device.ratedCycleLife,
      `Apple rates the ${device.marketingName} cell for ${device.ratedCycleLife} cycles`,
    );
    expectation(EvidenceSubject.SYSTEM_SOFTWARE, 'MaxSupportedIosMajor', device.maxIosMajor);
    if (device.releaseYear) {
      expectation(EvidenceSubject.DEVICE, 'ExpectedReleaseYear', device.releaseYear);
    }
  }
}

function collectLockdown(ctx: CollectorContext, snapshot: RawDeviceSnapshot): void {
  const record = (
    subject: EvidenceSubject,
    key: string,
    value: EvidenceValue,
    kind = EvidenceKind.DEVICE_PROPERTY,
  ): void => {
    if (value === undefined || value === null || value === '') return;
    ctx.ledger.record({
      kind,
      subject,
      key,
      value,
      source: EvidenceSource.DEVICE_OS,
      method: CollectionMethod.LOCKDOWN_GLOBAL_QUERY,
      collector: 'lockdown.global',
      observedAt: ctx.at,
      instrument: ctx.instrument,
    });
  };

  for (const key of DEVICE_KEYS) {
    const raw = pick(snapshot.lockdown, key);
    const value = typeof raw === 'number' ? raw : asString(raw);
    record(EvidenceSubject.DEVICE, key, value ?? null);
  }
  for (const key of SOFTWARE_KEYS) {
    record(EvidenceSubject.SYSTEM_SOFTWARE, key, asString(pick(snapshot.lockdown, key)));
  }
  for (const key of SECURITY_KEYS) {
    const raw = pick(snapshot.lockdown, key);
    const value = asBoolean(raw) ?? asString(raw);
    record(EvidenceSubject.SECURITY_STATE, key, value ?? null);
  }
}

/** Scoped lockdown domains, each with the subject it describes. */
const DOMAIN_MAP: Array<{
  domain: string;
  entries: Array<{ key: string; subject: EvidenceSubject; kind: EvidenceKind; as?: 'number' | 'boolean' | 'string' }>;
}> = [
  {
    domain: 'com.apple.disk_usage',
    entries: [
      { key: 'TotalDiskCapacity', subject: EvidenceSubject.DEVICE, kind: EvidenceKind.MEASUREMENT, as: 'number' },
      { key: 'TotalDataCapacity', subject: EvidenceSubject.SYSTEM_SOFTWARE, kind: EvidenceKind.MEASUREMENT, as: 'number' },
      { key: 'TotalDataAvailable', subject: EvidenceSubject.SYSTEM_SOFTWARE, kind: EvidenceKind.MEASUREMENT, as: 'number' },
    ],
  },
  {
    domain: 'com.apple.mobile.battery',
    entries: [
      { key: 'BatteryCurrentCapacity', subject: EvidenceSubject.BATTERY, kind: EvidenceKind.MEASUREMENT, as: 'number' },
      { key: 'BatteryIsCharging', subject: EvidenceSubject.BATTERY, kind: EvidenceKind.MEASUREMENT, as: 'boolean' },
      { key: 'FullyCharged', subject: EvidenceSubject.BATTERY, kind: EvidenceKind.MEASUREMENT, as: 'boolean' },
    ],
  },
  {
    domain: 'com.apple.mobile.mobilegestalt',
    entries: [
      { key: 'DisplaySupportsTrueTone', subject: EvidenceSubject.DISPLAY, kind: EvidenceKind.CAPABILITY_FLAG, as: 'boolean' },
      { key: 'TrueToneSupported', subject: EvidenceSubject.DISPLAY, kind: EvidenceKind.CAPABILITY_FLAG, as: 'boolean' },
      { key: 'SupportsFaceID', subject: EvidenceSubject.FACE_ID, kind: EvidenceKind.CAPABILITY_FLAG, as: 'boolean' },
      { key: 'FaceIDCapability', subject: EvidenceSubject.FACE_ID, kind: EvidenceKind.CAPABILITY_FLAG, as: 'boolean' },
    ],
  },
  {
    domain: 'com.apple.fmip',
    entries: [
      { key: 'IsAssociated', subject: EvidenceSubject.SECURITY_STATE, kind: EvidenceKind.DEVICE_PROPERTY, as: 'boolean' },
      { key: 'FMiPAccountExists', subject: EvidenceSubject.SECURITY_STATE, kind: EvidenceKind.DEVICE_PROPERTY, as: 'boolean' },
      { key: 'ActivationLockEnabled', subject: EvidenceSubject.SECURITY_STATE, kind: EvidenceKind.DEVICE_PROPERTY, as: 'boolean' },
    ],
  },
  {
    domain: 'com.apple.mobile.cloud_configuration',
    entries: [
      { key: 'IsSupervised', subject: EvidenceSubject.SECURITY_STATE, kind: EvidenceKind.DEVICE_PROPERTY, as: 'boolean' },
      { key: 'IsMDMUnremovable', subject: EvidenceSubject.SECURITY_STATE, kind: EvidenceKind.DEVICE_PROPERTY, as: 'boolean' },
      { key: 'IsMandatory', subject: EvidenceSubject.SECURITY_STATE, kind: EvidenceKind.DEVICE_PROPERTY, as: 'boolean' },
      { key: 'OrganizationName', subject: EvidenceSubject.SECURITY_STATE, kind: EvidenceKind.DEVICE_PROPERTY, as: 'string' },
      { key: 'ConfigurationURL', subject: EvidenceSubject.SECURITY_STATE, kind: EvidenceKind.DEVICE_PROPERTY, as: 'string' },
    ],
  },
];

function collectDomains(ctx: CollectorContext, snapshot: RawDeviceSnapshot): void {
  for (const mapping of DOMAIN_MAP) {
    const domain = snapshot.domains[mapping.domain];
    if (!domain) continue;

    for (const entry of mapping.entries) {
      const raw = pick(domain, entry.key);
      const value: EvidenceValue | null =
        entry.as === 'number'
          ? asNumber(raw)
          : entry.as === 'boolean'
            ? asBoolean(raw)
            : asString(raw);
      if (value === null || value === undefined) continue;

      ctx.ledger.record({
        kind: entry.kind,
        subject: entry.subject,
        key: entry.key,
        value,
        source: EvidenceSource.DEVICE_OS,
        method: CollectionMethod.LOCKDOWN_DOMAIN_QUERY,
        collector: `lockdown.${mapping.domain}`,
        observedAt: ctx.at,
        instrument: ctx.instrument,
        raw: `${mapping.domain}.${entry.key}`,
      });
    }
  }
}

function collectBatteryRegistry(ctx: CollectorContext, snapshot: RawDeviceSnapshot): void {
  const node = snapshot.ioregistry['AppleSmartBattery'];
  if (!node || Object.keys(node).length === 0) return;

  const reading = parseSmartBattery(node);
  const numeric: Array<[string, number | null]> = [
    ['DesignCapacity', reading.designCapacityMah],
    ['NominalChargeCapacity', reading.nominalChargeCapacityMah ?? reading.appleRawMaxCapacityMah],
    ['CycleCount', reading.cycleCount],
    ['CurrentCapacity', reading.currentChargePercent],
    ['Temperature', reading.temperatureCelsius],
  ];

  for (const [key, value] of numeric) {
    if (value === null) continue;
    ctx.ledger.record({
      kind: EvidenceKind.MEASUREMENT,
      subject: EvidenceSubject.BATTERY,
      key,
      value,
      source: EvidenceSource.DEVICE_HARDWARE_REGISTRY,
      method: CollectionMethod.DIAGNOSTICS_RELAY_IOREGISTRY,
      collector: 'battery.ioregistry',
      observedAt: ctx.at,
      instrument: ctx.instrument,
      raw: `AppleSmartBattery.${key}`,
    });
  }

  if (reading.serial) {
    ctx.ledger.record({
      kind: EvidenceKind.DEVICE_PROPERTY,
      subject: EvidenceSubject.BATTERY,
      key: 'CellSerial',
      value: reading.serial,
      source: EvidenceSource.DEVICE_HARDWARE_REGISTRY,
      method: CollectionMethod.DIAGNOSTICS_RELAY_IOREGISTRY,
      collector: 'battery.ioregistry',
      observedAt: ctx.at,
      instrument: ctx.instrument,
    });
  }

  const installed = asBoolean(pick(node, 'BatteryInstalled'));
  if (installed !== null) {
    ctx.ledger.record({
      kind: EvidenceKind.DEVICE_PROPERTY,
      subject: EvidenceSubject.BATTERY,
      key: 'BatteryInstalled',
      value: installed,
      source: EvidenceSource.DEVICE_HARDWARE_REGISTRY,
      method: CollectionMethod.DIAGNOSTICS_RELAY_IOREGISTRY,
      collector: 'battery.ioregistry',
      observedAt: ctx.at,
      instrument: ctx.instrument,
    });
  }
}

/** Analytics battery keys, canonicalised by the extractor. */
const ANALYTICS_BATTERY_KEYS: Record<string, string> = {
  designCapacityMah: 'DesignCapacity',
  nominalChargeCapacityMah: 'NominalChargeCapacity',
  cycleCount: 'CycleCount',
  maximumCapacityPercent: 'MaximumCapacityPercent',
  batterySerial: 'CellSerial',
};

/** Which component each known diagnostic string speaks about. */
export const DIAGNOSTIC_SUBJECTS: Record<string, EvidenceSubject> = {
  AppleSmartBatteryUnknownPart: EvidenceSubject.BATTERY,
  BatteryUnknownPart: EvidenceSubject.BATTERY,
  NonGenuineBattery: EvidenceSubject.BATTERY,
  DisplaySerialMismatch: EvidenceSubject.DISPLAY,
  AppleDisplayPipeAuthFailure: EvidenceSubject.DISPLAY,
  MultitouchCalibrationFailure: EvidenceSubject.DISPLAY,
  TrueToneDisabled: EvidenceSubject.DISPLAY,
  FaceIDPairingFailure: EvidenceSubject.FACE_ID,
  PearlNotPaired: EvidenceSubject.FACE_ID,
  CameraPairingFailure: EvidenceSubject.REAR_CAMERA,
  ServiceHistoryRecord: EvidenceSubject.LOGIC_BOARD,
};

function collectAnalytics(ctx: CollectorContext, snapshot: RawDeviceSnapshot): void {
  const analytics = snapshot.analytics;
  if (!analytics) return;

  for (const [canonical, key] of Object.entries(ANALYTICS_BATTERY_KEYS)) {
    const value = analytics.batteryKeys[canonical];
    if (value === undefined) continue;
    ctx.ledger.record({
      kind: EvidenceKind.MEASUREMENT,
      subject: EvidenceSubject.BATTERY,
      key,
      value: value as EvidenceValue,
      source: EvidenceSource.DEVICE_ANALYTICS,
      method: CollectionMethod.CRASH_REPORT_COPY,
      collector: 'analytics.battery',
      observedAt: toInstant(analytics.fileDate, ctx.at),
      instrument: ctx.instrument,
      raw: analytics.sourceFile,
      note: `Recovered from ${analytics.sourceFile}`,
    });
  }

  for (const pattern of analytics.diagnosticStrings) {
    const subject = DIAGNOSTIC_SUBJECTS[pattern];
    if (!subject) continue;
    ctx.ledger.record({
      kind: EvidenceKind.DIAGNOSTIC_EVENT,
      subject,
      key: pattern,
      value: true,
      source: EvidenceSource.DEVICE_ANALYTICS,
      method: CollectionMethod.CRASH_REPORT_COPY,
      collector: 'analytics.diagnostics',
      observedAt: toInstant(analytics.fileDate, ctx.at),
      instrument: ctx.instrument,
      raw: `${pattern} in ${analytics.sourceFile}`,
    });
  }
}

/**
 * Bundle identifiers that only exist on a jailbroken device. Recorded
 * individually so a security inference can cite the exact one it saw.
 */
export const JAILBREAK_BUNDLE_IDS = [
  'com.saurik.Cydia',
  'org.coolstar.SileoStore',
  'org.coolstar.sileo',
  'com.opa334.Dopamine',
  'com.tigisoftware.Filza',
  'com.serena.Zebra',
  'me.apptapp.installer',
  'org.coolstar.electra',
  'science.xnu.undecimus',
  'com.libhooker.libhooker',
  'xyz.willy.Zebra',
];

/** `com.apple.afc2` is the unsandboxed AFC service a jailbreak installs. */
export const JAILBREAK_SERVICES = ['com.apple.afc2', 'com.apple.afc2d'];

function collectSoftwareInventory(ctx: CollectorContext, snapshot: RawDeviceSnapshot): void {
  ctx.ledger.record({
    kind: EvidenceKind.SOFTWARE_INVENTORY,
    subject: EvidenceSubject.SECURITY_STATE,
    key: 'InstalledAppCount',
    value: snapshot.installedApps.length,
    source: EvidenceSource.DEVICE_OS,
    method: CollectionMethod.INSTALLATION_PROXY_LIST,
    collector: 'software.inventory',
    observedAt: ctx.at,
    instrument: ctx.instrument,
  });

  const lowered = new Map(snapshot.installedApps.map((id) => [id.toLowerCase(), id]));
  for (const bundleId of JAILBREAK_BUNDLE_IDS) {
    const found = lowered.get(bundleId.toLowerCase());
    if (!found) continue;
    ctx.ledger.record({
      kind: EvidenceKind.SOFTWARE_INVENTORY,
      subject: EvidenceSubject.SECURITY_STATE,
      key: 'JailbreakBundlePresent',
      value: found,
      source: EvidenceSource.DEVICE_OS,
      method: CollectionMethod.INSTALLATION_PROXY_LIST,
      collector: 'software.inventory',
      observedAt: ctx.at,
      instrument: ctx.instrument,
      note: `Installed application ${found} exists only on jailbroken systems`,
    });
  }
}

function collectServiceAvailability(ctx: CollectorContext, snapshot: RawDeviceSnapshot): void {
  const advertised = new Set(snapshot.services.map((s) => s.toLowerCase()));
  for (const service of JAILBREAK_SERVICES) {
    if (!advertised.has(service.toLowerCase())) continue;
    ctx.ledger.record({
      kind: EvidenceKind.SERVICE_AVAILABILITY,
      subject: EvidenceSubject.SECURITY_STATE,
      key: 'UnsandboxedServiceAdvertised',
      value: service,
      source: EvidenceSource.DEVICE_OS,
      method: CollectionMethod.SERVICE_PROBE,
      collector: 'services.probe',
      observedAt: ctx.at,
      instrument: ctx.instrument,
      note: `Stock iOS never advertises ${service}`,
    });
  }

  ctx.ledger.record({
    kind: EvidenceKind.SERVICE_AVAILABILITY,
    subject: EvidenceSubject.SECURITY_STATE,
    key: 'DiagnosticsRelayResponded',
    value: Object.keys(snapshot.ioregistry).length > 0,
    source: EvidenceSource.DEVICE_OS,
    method: CollectionMethod.SERVICE_PROBE,
    collector: 'services.probe',
    observedAt: ctx.at,
    instrument: ctx.instrument,
  });
}

/** Component names as iOS renders them, mapped to evidence subjects. */
export function normaliseComponentName(label: string): EvidenceSubject | null {
  const key = label.trim().toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ');
  const table: Record<string, EvidenceSubject> = {
    display: EvidenceSubject.DISPLAY,
    screen: EvidenceSubject.DISPLAY,
    battery: EvidenceSubject.BATTERY,
    camera: EvidenceSubject.REAR_CAMERA,
    'rear camera': EvidenceSubject.REAR_CAMERA,
    'back camera': EvidenceSubject.REAR_CAMERA,
    'front camera': EvidenceSubject.FRONT_CAMERA,
    'true depth camera': EvidenceSubject.FRONT_CAMERA,
    'truedepth camera': EvidenceSubject.FRONT_CAMERA,
    'face id': EvidenceSubject.FACE_ID,
    faceid: EvidenceSubject.FACE_ID,
    'touch id': EvidenceSubject.TOUCH_ID,
    touchid: EvidenceSubject.TOUCH_ID,
    'rear housing': EvidenceSubject.REAR_HOUSING,
    housing: EvidenceSubject.REAR_HOUSING,
    'logic board': EvidenceSubject.LOGIC_BOARD,
    lidar: EvidenceSubject.LIDAR,
    speaker: EvidenceSubject.SPEAKER,
    'top speaker': EvidenceSubject.SPEAKER,
    microphone: EvidenceSubject.MICROPHONE,
    'taptic engine': EvidenceSubject.TAPTIC_ENGINE,
  };
  return table[key] ?? null;
}

function collectAttestation(ctx: CollectorContext, snapshot: RawDeviceSnapshot): void {
  const attestation = snapshot.attestation;
  if (!attestation) return;

  const method =
    attestation.method === 'OCR' ? CollectionMethod.OCR_EXTRACTION : CollectionMethod.TECHNICIAN_INPUT;

  if (attestation.sectionAbsent) {
    ctx.ledger.record({
      kind: EvidenceKind.SERVICE_RECORD_STATEMENT,
      subject: EvidenceSubject.DEVICE,
      key: 'ServiceHistorySectionAbsent',
      value: true,
      source: EvidenceSource.TECHNICIAN,
      method,
      collector: 'attestation.service-history',
      observedAt: toInstant(attestation.capturedAt, ctx.at),
      note: 'iOS displayed no Parts and Service History section',
    });
    return;
  }

  for (const entry of attestation.entries) {
    const subject = normaliseComponentName(entry.component);
    if (!subject) continue;
    if (!Object.values(AppleServiceHistoryLabel).includes(entry.label)) continue;

    ctx.ledger.record({
      kind: EvidenceKind.SERVICE_RECORD_STATEMENT,
      subject,
      key: 'ServiceHistoryLabel',
      value: entry.label,
      source: EvidenceSource.TECHNICIAN,
      method,
      collector: 'attestation.service-history',
      observedAt: toInstant(attestation.capturedAt, ctx.at),
      raw: `${entry.component}: ${entry.label}`,
      note: `Technician ${attestation.capturedBy} transcribed the on-device service history`,
    });
  }
}

/** Which subject a failed collector was trying to learn about. */
const COLLECTOR_SUBJECTS: Record<string, EvidenceSubject> = {
  'battery.ioregistry': EvidenceSubject.BATTERY,
  'analytics.crashreport': EvidenceSubject.DEVICE,
  installation_proxy: EvidenceSubject.SECURITY_STATE,
  service_discovery: EvidenceSubject.SECURITY_STATE,
};

function collectFailures(ctx: CollectorContext, snapshot: RawDeviceSnapshot): void {
  for (const error of snapshot.errors) {
    const subject =
      COLLECTOR_SUBJECTS[error.collector] ??
      (error.collector.startsWith('lockdown.') ? EvidenceSubject.DEVICE : EvidenceSubject.DEVICE);

    ctx.ledger.recordFailure({
      subject,
      key: error.collector,
      reason: error.code ?? FailureReason.UNKNOWN,
      source: EvidenceSource.DEVICE_OS,
      method: CollectionMethod.SERVICE_PROBE,
      collector: error.collector,
      observedAt: ctx.at,
      detail: error.message,
    });
  }
}
