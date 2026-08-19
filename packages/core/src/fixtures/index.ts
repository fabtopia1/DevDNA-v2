import { CollectionErrorCode } from '../types/common.js';
import {
  AppleServiceHistoryLabel,
  type RawDeviceSnapshot,
  type ServiceHistoryAttestation,
} from '../types/device.js';

/**
 * Deterministic device fixtures.
 *
 * These back three things: the Bridge's `--simulator` mode (so the product can
 * be demonstrated and developed without a handset on the desk), the seed data
 * for a fresh install, and the engine test suite. Because they are ordinary
 * `RawDeviceSnapshot` values they exercise exactly the same code path as a real
 * USB capture — there is no separate "demo" branch anywhere in the engines.
 */

export type SimulatorProfileId =
  | 'pristine-15-pro'
  | 'serviced-14-pro'
  | 'counterfeit-display-13'
  | 'activation-locked-12'
  | 'legacy-sparse-8';

export interface SimulatorProfile {
  id: SimulatorProfileId;
  label: string;
  description: string;
  build: () => RawDeviceSnapshot;
}

const CAPTURED_AT = '2026-03-14T10:24:00.000Z';

function baseSnapshot(overrides: Partial<RawDeviceSnapshot> = {}): RawDeviceSnapshot {
  return {
    schemaVersion: 1,
    capturedAt: CAPTURED_AT,
    bridge: {
      version: '0.1.0',
      platform: 'darwin',
      toolchain: { ideviceinfo: 'simulated', idevicediagnostics: 'simulated' },
      mode: 'simulator',
    },
    lockdown: {},
    domains: {},
    ioregistry: {},
    analytics: null,
    installedApps: [],
    services: ['com.apple.mobile.lockdown', 'com.apple.afc', 'com.apple.crashreportcopymobile'],
    attestation: null,
    errors: [],
    ...overrides,
  };
}

function attestation(
  entries: Array<[string, AppleServiceHistoryLabel]>,
): ServiceHistoryAttestation {
  return {
    capturedBy: 'simulator',
    capturedAt: CAPTURED_AT,
    method: 'MANUAL',
    entries: entries.map(([component, label]) => ({ component, label })),
  };
}

/** A boxed-fresh device: everything genuine, battery near new. */
function pristine15Pro(): RawDeviceSnapshot {
  return baseSnapshot({
    lockdown: {
      DeviceName: 'iPhone',
      ProductType: 'iPhone16,1',
      ProductVersion: '18.3.1',
      BuildVersion: '22D72',
      UniqueDeviceID: '00008130-000A4D2E0EC0001C',
      DeviceClass: 'iPhone',
      HardwareModel: 'D83AP',
      ModelNumber: 'MTUW3',
      RegionInfo: 'LL/A',
      SerialNumber: 'K7XVL2Q9PN',
      InternationalMobileEquipmentIdentity: '353XXXXXXXXXX21',
      CPUArchitecture: 'arm64e',
      ActivationState: 'Activated',
      PasswordProtected: true,
      TotalDiskCapacity: 256_000_000_000,
    },
    domains: {
      'com.apple.disk_usage': {
        TotalDiskCapacity: 256_000_000_000,
        TotalDataCapacity: 245_107_195_904,
        TotalDataAvailable: 208_331_116_544,
      },
      'com.apple.mobile.battery': { BatteryCurrentCapacity: 87, BatteryIsCharging: false },
      'com.apple.mobile.mobilegestalt': { DisplaySupportsTrueTone: true, SupportsFaceID: true },
      'com.apple.fmip': { IsAssociated: false },
      'com.apple.mobile.cloud_configuration': { IsSupervised: false },
    },
    ioregistry: {
      AppleSmartBattery: {
        DesignCapacity: 3274,
        NominalChargeCapacity: 3241,
        AppleRawMaxCapacity: 3238,
        CycleCount: 42,
        CurrentCapacity: 87,
        Serial: 'F8Y2340A1QRJKLMN',
        BatteryInstalled: true,
        IsCharging: false,
        Temperature: 2980,
      },
    },
    attestation: {
      capturedBy: 'simulator',
      capturedAt: CAPTURED_AT,
      method: 'MANUAL',
      entries: [],
      sectionAbsent: true,
    },
  });
}

/** Apple-serviced device: genuine replacement display, transplanted battery. */
function serviced14Pro(): RawDeviceSnapshot {
  return baseSnapshot({
    lockdown: {
      DeviceName: 'Trade-in 4412',
      ProductType: 'iPhone15,2',
      ProductVersion: '18.2',
      BuildVersion: '22C152',
      UniqueDeviceID: '00008120-001A15E23E38401E',
      DeviceClass: 'iPhone',
      HardwareModel: 'D73AP',
      ModelNumber: 'MQ0G3',
      RegionInfo: 'B/A',
      SerialNumber: 'FK2Q7WXYZ1',
      CPUArchitecture: 'arm64e',
      ActivationState: 'Activated',
      PasswordProtected: false,
      TotalDiskCapacity: 128_000_000_000,
    },
    domains: {
      'com.apple.disk_usage': {
        TotalDiskCapacity: 128_000_000_000,
        TotalDataCapacity: 118_874_374_144,
        TotalDataAvailable: 41_027_301_376,
      },
      'com.apple.mobile.battery': { BatteryCurrentCapacity: 64, BatteryIsCharging: true },
      'com.apple.mobile.mobilegestalt': { DisplaySupportsTrueTone: true, SupportsFaceID: true },
      'com.apple.fmip': { IsAssociated: false },
      'com.apple.mobile.cloud_configuration': { IsSupervised: false },
    },
    ioregistry: {
      AppleSmartBattery: {
        DesignCapacity: 3200,
        NominalChargeCapacity: 2976,
        CycleCount: 412,
        CurrentCapacity: 64,
        Serial: 'F9K1120B7ZXCVBNM',
        BatteryInstalled: true,
        IsCharging: true,
      },
    },
    analytics: {
      sourceFile: 'log-aggregated-2026-03-11-100442.ips',
      fileDate: '2026-03-11',
      batteryKeys: { cycleCount: 412, nominalChargeCapacityMah: 2976, designCapacityMah: 3200 },
      diagnosticStrings: ['DisplaySerialMismatch'],
    },
    attestation: attestation([
      ['Display', AppleServiceHistoryLabel.GENUINE_APPLE_PART],
      ['Battery', AppleServiceHistoryLabel.USED_APPLE_PART],
      ['Camera', AppleServiceHistoryLabel.GENUINE_APPLE_PART],
    ]),
  });
}

/** Third-party display and battery — the case the product exists to catch. */
function counterfeitDisplay13(): RawDeviceSnapshot {
  return baseSnapshot({
    lockdown: {
      DeviceName: 'iPhone',
      ProductType: 'iPhone14,5',
      ProductVersion: '17.6.1',
      BuildVersion: '21G93',
      UniqueDeviceID: '00008110-000E4C1A2288801E',
      DeviceClass: 'iPhone',
      HardwareModel: 'D16AP',
      ModelNumber: 'MLPF3',
      RegionInfo: 'ZP/A',
      SerialNumber: 'H2LM90PQRS',
      CPUArchitecture: 'arm64e',
      ActivationState: 'Activated',
      PasswordProtected: false,
      TotalDiskCapacity: 128_000_000_000,
    },
    domains: {
      'com.apple.disk_usage': {
        TotalDiskCapacity: 128_000_000_000,
        TotalDataCapacity: 118_874_374_144,
        TotalDataAvailable: 6_442_450_944,
      },
      'com.apple.mobile.battery': { BatteryCurrentCapacity: 41, BatteryIsCharging: false },
      'com.apple.mobile.mobilegestalt': { DisplaySupportsTrueTone: false, SupportsFaceID: true },
      'com.apple.fmip': { IsAssociated: false },
      'com.apple.mobile.cloud_configuration': { IsSupervised: false },
    },
    ioregistry: {
      AppleSmartBattery: {
        DesignCapacity: 3227,
        NominalChargeCapacity: 2452,
        CycleCount: 863,
        CurrentCapacity: 41,
        BatteryInstalled: true,
      },
    },
    analytics: {
      sourceFile: 'log-aggregated-2026-03-09-081120.ips',
      fileDate: '2026-03-09',
      batteryKeys: { cycleCount: 863, nominalChargeCapacityMah: 2452, designCapacityMah: 3227 },
      diagnosticStrings: [
        'AppleDisplayPipeAuthFailure',
        'MultitouchCalibrationFailure',
        'NonGenuineBattery',
      ],
    },
    attestation: attestation([
      ['Display', AppleServiceHistoryLabel.UNKNOWN_PART],
      ['Battery', AppleServiceHistoryLabel.UNKNOWN_PART],
    ]),
  });
}

/** Activation-locked stock: unsellable regardless of condition. */
function activationLocked12(): RawDeviceSnapshot {
  return baseSnapshot({
    lockdown: {
      DeviceName: 'iPhone',
      ProductType: 'iPhone13,2',
      ProductVersion: '18.3.1',
      BuildVersion: '22D72',
      UniqueDeviceID: '00008101-0016482E1A38001E',
      DeviceClass: 'iPhone',
      HardwareModel: 'D53gAP',
      ModelNumber: 'MGJ83',
      RegionInfo: 'F/A',
      SerialNumber: 'C8XN44TUVW',
      CPUArchitecture: 'arm64e',
      ActivationState: 'Activated',
      PasswordProtected: true,
      TotalDiskCapacity: 64_000_000_000,
    },
    domains: {
      'com.apple.disk_usage': {
        TotalDiskCapacity: 64_000_000_000,
        TotalDataCapacity: 55_247_314_944,
        TotalDataAvailable: 21_474_836_480,
      },
      'com.apple.mobile.battery': { BatteryCurrentCapacity: 55, BatteryIsCharging: false },
      'com.apple.mobile.mobilegestalt': { DisplaySupportsTrueTone: true, SupportsFaceID: true },
      'com.apple.fmip': { IsAssociated: true },
      'com.apple.mobile.cloud_configuration': { IsSupervised: true, OrganizationName: 'Acme Logistics' },
    },
    ioregistry: {
      AppleSmartBattery: {
        DesignCapacity: 2815,
        NominalChargeCapacity: 2477,
        CycleCount: 604,
        CurrentCapacity: 55,
        Serial: 'F7T0918C3ASDFGHJ',
        BatteryInstalled: true,
      },
    },
  });
}

/**
 * An older handset on a modern iOS build where the diagnostics relay refuses
 * IORegistry queries and no analytics are stored. This is the realistic
 * low-information case, and it must come back INCONCLUSIVE rather than pass.
 */
function legacySparse8(): RawDeviceSnapshot {
  return baseSnapshot({
    lockdown: {
      DeviceName: 'iPhone 8',
      ProductType: 'iPhone10,1',
      ProductVersion: '16.7.11',
      BuildVersion: '20H360',
      UniqueDeviceID: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
      DeviceClass: 'iPhone',
      HardwareModel: 'D20AP',
      ModelNumber: 'MQ6G2',
      RegionInfo: 'X/A',
      SerialNumber: 'DNPQ55ABCD',
      CPUArchitecture: 'arm64',
      ActivationState: 'Activated',
      PasswordProtected: false,
      TotalDiskCapacity: 64_000_000_000,
    },
    domains: {
      'com.apple.disk_usage': {
        TotalDiskCapacity: 64_000_000_000,
        TotalDataCapacity: 55_247_314_944,
        TotalDataAvailable: 3_221_225_472,
      },
      'com.apple.mobile.battery': { BatteryCurrentCapacity: 29, BatteryIsCharging: false },
    },
    errors: [
      {
        collector: 'battery.ioregistry',
        code: CollectionErrorCode.SERVICE_UNAVAILABLE,
        message:
          'com.apple.mobile.diagnostics_relay declined the AppleSmartBattery query on this iOS build.',
      },
      {
        collector: 'analytics.crashreport',
        code: CollectionErrorCode.SERVICE_UNAVAILABLE,
        message: 'No aggregated analytics files are stored on the device.',
      },
    ],
  });
}

export const SIMULATOR_PROFILES: SimulatorProfile[] = [
  {
    id: 'pristine-15-pro',
    label: 'iPhone 15 Pro — pristine',
    description: 'Unserviced handset, 99% battery health, all components original.',
    build: pristine15Pro,
  },
  {
    id: 'serviced-14-pro',
    label: 'iPhone 14 Pro — Apple serviced',
    description: 'Genuine replacement display and a transplanted Apple battery.',
    build: serviced14Pro,
  },
  {
    id: 'counterfeit-display-13',
    label: 'iPhone 13 — third-party parts',
    description: 'Non-genuine display and battery, heavily cycled cell.',
    build: counterfeitDisplay13,
  },
  {
    id: 'activation-locked-12',
    label: 'iPhone 12 — activation locked',
    description: 'Find My enabled and MDM supervised; not resellable as-is.',
    build: activationLocked12,
  },
  {
    id: 'legacy-sparse-8',
    label: 'iPhone 8 — minimal data',
    description: 'Diagnostics relay unavailable and no analytics; expected to be inconclusive.',
    build: legacySparse8,
  },
];

export function simulatorProfile(id: SimulatorProfileId): SimulatorProfile {
  const profile = SIMULATOR_PROFILES.find((p) => p.id === id);
  if (!profile) throw new Error(`Unknown simulator profile: ${id}`);
  return profile;
}

export function buildSimulatedSnapshot(id: SimulatorProfileId): RawDeviceSnapshot {
  return simulatorProfile(id).build();
}
