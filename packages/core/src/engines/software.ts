import {
  clamp,
  DataSource,
  observe,
  round,
  Severity,
  type Finding,
} from '../types/common.js';
import type { SoftwareAssessment } from '../types/software.js';
import type { RawDeviceSnapshot } from '../types/device.js';
import { asBoolean, asNumber, asString, pick } from '../parsers/ideviceinfo.js';
import { compareVersions, NEWEST_MAJOR, parseVersion, trainFor } from '../catalog/ios-releases.js';
import { resolveDevice } from '../catalog/devices.js';

const DISK_DOMAIN = 'com.apple.disk_usage';

/**
 * Bundle identifiers that only exist on a jailbroken device. Presence is a
 * strong integrity signal: a jailbroken handset can spoof every value further
 * up this pipeline, so it caps the trust score outright.
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

/**
 * `com.apple.afc2` is the classic unsandboxed AFC service installed by
 * jailbreaks; stock iOS never advertises it.
 */
export const JAILBREAK_SERVICES = ['com.apple.afc2', 'com.apple.afc2d'];

export function assessSoftware(snapshot: RawDeviceSnapshot): SoftwareAssessment {
  const ld = snapshot.lockdown;
  const disk = snapshot.domains[DISK_DOMAIN] ?? {};
  const findings: Finding[] = [];
  const at = snapshot.capturedAt;

  const iosVersion = asString(pick(ld, 'ProductVersion'));
  const buildVersion = asString(pick(ld, 'BuildVersion'));
  const device = resolveDevice(asString(pick(ld, 'ProductType')));

  const totalBytes = asNumber(pick(disk, 'TotalDataCapacity', 'TotalDiskCapacity'));
  const availableBytes = asNumber(pick(disk, 'TotalDataAvailable', 'AmountDataAvailable'));
  const usedPercent =
    totalBytes && totalBytes > 0 && availableBytes !== null
      ? round(clamp(((totalBytes - availableBytes) / totalBytes) * 100), 1)
      : null;

  const uptimeRaw = asNumber(pick(ld, 'UptimeSeconds', 'SystemUptime'));
  const uptimeSeconds =
    uptimeRaw === null
      ? null
      : observe(uptimeRaw, DataSource.DIAGNOSTICS_RELAY, {
          observedAt: at,
        });

  const diagnosticsAvailable = Object.keys(snapshot.ioregistry).length > 0;
  const developerModeEnabled = asBoolean(pick(ld, 'DeveloperModeStatus', 'DeveloperMode'));

  const jailbreakIndicators: string[] = [];
  for (const bundleId of snapshot.installedApps) {
    if (JAILBREAK_BUNDLE_IDS.some((id) => id.toLowerCase() === bundleId.toLowerCase())) {
      jailbreakIndicators.push(`installed app: ${bundleId}`);
    }
  }
  for (const service of snapshot.services) {
    if (JAILBREAK_SERVICES.some((s) => s.toLowerCase() === service.toLowerCase())) {
      jailbreakIndicators.push(`lockdown service: ${service}`);
    }
  }
  const jailbreakSuspected = jailbreakIndicators.length > 0;

  // Version currency, measured against the newest train the device supports
  // rather than the newest train that exists.
  const major = parseVersion(iosVersion)?.[0] ?? null;
  const supportedMajor = Math.min(device.maxIosMajor, NEWEST_MAJOR);
  const train = major === null ? null : trainFor(major);
  const latestKnownVersion = trainFor(supportedMajor)?.latestVersion ?? null;
  const majorVersionsBehind = major === null ? null : Math.max(0, supportedMajor - major);

  let score = 100;

  if (majorVersionsBehind !== null && majorVersionsBehind > 0) {
    const penalty = majorVersionsBehind === 1 ? 8 : Math.min(22, 8 + (majorVersionsBehind - 1) * 6);
    score -= penalty;
    findings.push({
      code: 'IOS_MAJOR_BEHIND',
      severity: majorVersionsBehind >= 2 ? Severity.MEDIUM : Severity.LOW,
      title: `iOS ${iosVersion} is ${majorVersionsBehind} major version${majorVersionsBehind > 1 ? 's' : ''} behind`,
      detail: `This device supports up to iOS ${supportedMajor}. Update before resale where possible.`,
      source: DataSource.LOCKDOWN,
    });
  } else if (
    train &&
    iosVersion &&
    compareVersions(iosVersion, train.latestVersion) < 0
  ) {
    score -= 3;
    findings.push({
      code: 'IOS_MINOR_BEHIND',
      severity: Severity.INFO,
      title: `iOS ${iosVersion} is behind ${train.latestVersion}`,
      detail: 'A point release is available on the same major train.',
      source: DataSource.LOCKDOWN,
    });
  }

  if (train?.securityUpdatesEnded) {
    score -= 12;
    findings.push({
      code: 'IOS_UNSUPPORTED',
      severity: Severity.MEDIUM,
      title: `iOS ${major} no longer receives security updates`,
      detail: 'Devices on an unsupported train carry disclosure risk for business buyers.',
      source: DataSource.LOCKDOWN,
    });
  }

  if (usedPercent !== null && usedPercent > 95) {
    score -= 8;
    findings.push({
      code: 'STORAGE_CRITICAL',
      severity: Severity.MEDIUM,
      title: `Storage ${usedPercent}% full`,
      detail: 'Almost no free space. Erase the device before resale.',
      source: DataSource.LOCKDOWN_DOMAIN,
    });
  } else if (usedPercent !== null && usedPercent > 85) {
    score -= 3;
    findings.push({
      code: 'STORAGE_LOW',
      severity: Severity.LOW,
      title: `Storage ${usedPercent}% full`,
      detail: 'Free space is limited; the device has not been erased.',
      source: DataSource.LOCKDOWN_DOMAIN,
    });
  }

  if (jailbreakSuspected) {
    score -= 45;
    findings.push({
      code: 'JAILBREAK_SUSPECTED',
      severity: Severity.CRITICAL,
      title: 'Jailbreak indicators present',
      detail:
        `Detected: ${jailbreakIndicators.join(', ')}. A modified system can falsify every ` +
        'other value in this report, so all results are treated as untrusted.',
      source: DataSource.SERVICE_DISCOVERY,
    });
  }

  if (developerModeEnabled) {
    score -= 4;
    findings.push({
      code: 'DEVELOPER_MODE_ON',
      severity: Severity.INFO,
      title: 'Developer Mode is enabled',
      detail: 'Expected on engineering units; unusual on retail stock.',
      source: DataSource.LOCKDOWN,
    });
  }

  if (!diagnosticsAvailable) {
    findings.push({
      code: 'DIAGNOSTICS_UNAVAILABLE',
      severity: Severity.LOW,
      title: 'Diagnostics relay did not respond',
      detail:
        'Battery and component data fell back to lower-fidelity sources. This is normal on ' +
        'recent iOS builds and lowers confidence rather than the score.',
      source: DataSource.DIAGNOSTICS_RELAY,
    });
  }

  // Confidence reflects how much of the software picture we could actually see.
  const available = [
    iosVersion !== null,
    totalBytes !== null,
    snapshot.services.length > 0,
    diagnosticsAvailable,
  ];
  const coverage = available.filter(Boolean).length / available.length;
  const confidence = round(clamp(0.55 + 0.45 * coverage, 0, 1), 3);

  return {
    iosVersion,
    buildVersion,
    latestKnownVersion,
    majorVersionsBehind,
    storage: { totalBytes, availableBytes, usedPercent },
    uptimeSeconds,
    diagnosticsAvailable,
    developerModeEnabled,
    jailbreakIndicators,
    jailbreakSuspected,
    score: round(clamp(score)),
    confidence,
    findings,
  };
}
