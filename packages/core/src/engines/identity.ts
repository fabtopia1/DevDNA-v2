import {
  DataSource,
  observe,
  type Observation,
} from '../types/common.js';
import type {
  ActivationSummary,
  DeviceIdentity,
  IdentityAssessment,
  RawDeviceSnapshot,
} from '../types/device.js';
import { asBoolean, asNumber, asString, pick } from '../parsers/ideviceinfo.js';
import { inferMarketingCapacityGb, resolveDevice } from '../catalog/devices.js';
import { resolveRegion } from '../catalog/regions.js';
import { hashIdentifier } from '../util/hash.js';

const DISK_DOMAIN = 'com.apple.disk_usage';
const CLOUD_CONFIG_DOMAIN = 'com.apple.mobile.cloud_configuration';
const FMIP_DOMAIN = 'com.apple.fmip';

/**
 * Build the normalised device identity from a raw snapshot.
 *
 * Every field is sourced from the global lockdown domain or an explicitly
 * named scoped domain; nothing here requires more than a trusted pairing.
 */
export function assessIdentity(
  snapshot: RawDeviceSnapshot,
  options: { udidSalt?: string } = {},
): IdentityAssessment {
  const ld = snapshot.lockdown;
  const disk = snapshot.domains[DISK_DOMAIN] ?? {};
  const observations: Record<string, Observation<unknown>> = {};
  const at = snapshot.capturedAt;
  const source = DataSource.LOCKDOWN;

  const record = <T>(key: string, value: T, src: DataSource = source, note?: string): T => {
    if (value !== null && value !== undefined) {
      observations[key] = observe(value, src, { observedAt: at, ...(note ? { note } : {}) }) as Observation<unknown>;
    }
    return value;
  };

  const productType = asString(pick(ld, 'ProductType')) ?? '';
  const device = resolveDevice(productType);
  const region = resolveRegion(asString(pick(ld, 'RegionInfo')));

  const totalDiskCapacityBytes =
    asNumber(pick(disk, 'TotalDiskCapacity')) ?? asNumber(pick(ld, 'TotalDiskCapacity'));

  const udid = asString(pick(ld, 'UniqueDeviceID', 'UDID')) ?? '';

  const identity: DeviceIdentity = {
    productType,
    marketingName: device.marketingName,
    recognisedModel: device.recognised,
    deviceName: record('deviceName', asString(pick(ld, 'DeviceName'))),
    hardwareModel: record('hardwareModel', asString(pick(ld, 'HardwareModel'))),
    modelNumber: record('modelNumber', asString(pick(ld, 'ModelNumber'))),
    regionCode: region.code,
    regionName: region.name,
    totalDiskCapacityBytes: record(
      'totalDiskCapacityBytes',
      totalDiskCapacityBytes,
      DataSource.LOCKDOWN_DOMAIN,
    ),
    marketingCapacityGb: inferMarketingCapacityGb(totalDiskCapacityBytes),
    udid,
    udidHash: udid ? hashIdentifier(udid, options.udidSalt ?? '') : '',
    serialNumber: record('serialNumber', asString(pick(ld, 'SerialNumber'))),
    imei: record('imei', asString(pick(ld, 'InternationalMobileEquipmentIdentity', 'IMEI'))),
    meid: record('meid', asString(pick(ld, 'MobileEquipmentIdentifier', 'MEID'))),
    eid: record('eid', asString(pick(ld, 'EmbeddedIdentityDocument', 'EID'))),
    iosVersion: record('iosVersion', asString(pick(ld, 'ProductVersion'))),
    buildVersion: record('buildVersion', asString(pick(ld, 'BuildVersion'))),
    deviceClass: record('deviceClass', asString(pick(ld, 'DeviceClass'))),
    cpuArchitecture: record('cpuArchitecture', asString(pick(ld, 'CPUArchitecture'))),
    activation: assessActivation(snapshot),
    releaseYear: device.releaseYear || null,
  };

  record('productType', productType);
  record('activationState', identity.activation.state);

  return { identity, observations };
}

/**
 * Activation, Activation Lock and MDM state.
 *
 * `ActivationState` and `PasswordProtected` come from the global lockdown
 * domain. Supervision/DEP state comes from `com.apple.mobile.cloud_configuration`,
 * which is what Apple Configurator itself reads.
 *
 * Activation Lock has no guaranteed lockdown key: where the `com.apple.fmip`
 * domain answers we use it, otherwise the field stays `null` ("could not be
 * determined") and the trust engine raises a manual-check finding. We do not
 * infer Activation Lock from an activated device — a device can be both.
 */
export function assessActivation(snapshot: RawDeviceSnapshot): ActivationSummary {
  const ld = snapshot.lockdown;
  const cloud = snapshot.domains[CLOUD_CONFIG_DOMAIN] ?? {};
  const fmip = snapshot.domains[FMIP_DOMAIN] ?? {};

  const state = asString(pick(ld, 'ActivationState'));
  const activationLock =
    asBoolean(pick(fmip, 'IsAssociated', 'FMiPAccountExists', 'ActivationLockEnabled')) ??
    asBoolean(pick(ld, 'ActivationLockEnabled')) ??
    null;

  return {
    state,
    activated: state !== null && /^(Activated|FactoryActivated|WildcardActivated)$/i.test(state),
    activationLockEnabled: activationLock,
    supervised: asBoolean(pick(cloud, 'IsSupervised')) ?? null,
    mdmEnrolled:
      asBoolean(pick(cloud, 'IsMDMUnremovable', 'IsMandatory')) ??
      (asString(pick(cloud, 'ConfigurationURL', 'OrganizationName')) ? true : null),
    passcodeSet: asBoolean(pick(ld, 'PasswordProtected')),
  };
}
