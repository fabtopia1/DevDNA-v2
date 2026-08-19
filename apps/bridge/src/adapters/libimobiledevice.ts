import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CollectionErrorCode,
  extractAnalytics,
  mergeAnalytics,
  parseIdeviceInfo,
  parsePlistDict,
  type AnalyticsExtract,
  type CollectionError,
} from '@devdna/core';
import { assertValidUdid, run, ToolMissingError, type ExecResult } from './exec.js';

/**
 * Thin, typed wrapper over the libimobiledevice command-line suite.
 *
 * Everything here uses the same publicly documented lockdown services that
 * Finder, iTunes and Apple Configurator use over a trusted USB pairing. No
 * jailbreak, no exploit, no Apple-internal endpoint.
 *
 * Tools used, and the service each one speaks to:
 *   idevice_id            usbmuxd device enumeration
 *   idevicepair           com.apple.mobile.lockdown pairing/trust
 *   ideviceinfo           com.apple.mobile.lockdown property domains
 *   idevicediagnostics    com.apple.mobile.diagnostics_relay
 *   ideviceinstaller      com.apple.mobile.installation_proxy
 *   idevicecrashreport    com.apple.crashreportcopymobile
 */

export const TOOLS = {
  deviceId: 'idevice_id',
  pair: 'idevicepair',
  info: 'ideviceinfo',
  diagnostics: 'idevicediagnostics',
  installer: 'ideviceinstaller',
  crashReport: 'idevicecrashreport',
} as const;

export interface ToolchainStatus {
  available: boolean;
  versions: Record<string, string>;
  missing: string[];
}

export interface ConnectedDevice {
  udid: string;
  /** usbmux connection type, when the tool reports it. */
  connection: 'usb' | 'network' | 'unknown';
}

export interface PairingStatus {
  paired: boolean;
  message: string;
}

export class LibimobiledeviceAdapter {
  constructor(private readonly timeoutSeconds = 25) {}

  /** Probe which tools are installed. Reported to the dashboard on connect. */
  async toolchain(): Promise<ToolchainStatus> {
    const versions: Record<string, string> = {};
    const missing: string[] = [];
    await Promise.all(
      Object.values(TOOLS).map(async (tool) => {
        try {
          // Most libimobiledevice tools print their version to stderr and exit
          // non-zero for -v; we only care that the binary resolved.
          const result = await run(tool, ['-v'], { timeoutSeconds: 5 });
          const text = `${result.stdout} ${result.stderr}`.trim();
          versions[tool] = /(\d+\.\d+\.\d+)/.exec(text)?.[1] ?? 'unknown';
        } catch (error) {
          if (error instanceof ToolMissingError) missing.push(tool);
          else missing.push(tool);
        }
      }),
    );
    return { available: missing.length === 0, versions, missing };
  }

  /** Enumerate attached devices. USB only — network pairings are ignored. */
  async listDevices(): Promise<ConnectedDevice[]> {
    const result = await run(TOOLS.deviceId, ['-l'], { timeoutSeconds: 8 });
    return result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((udid) => ({ udid, connection: 'usb' as const }))
      .filter((device) => {
        try {
          assertValidUdid(device.udid);
          return true;
        } catch {
          return false;
        }
      });
  }

  /**
   * Check the trust pairing. A device that has not been unlocked and trusted
   * answers almost nothing, so the dashboard must be able to tell a technician
   * "tap Trust on the handset" rather than showing an empty report.
   */
  async pairingStatus(udid: string): Promise<PairingStatus> {
    const id = assertValidUdid(udid);
    const result = await run(TOOLS.pair, ['-u', id, 'validate'], { timeoutSeconds: 10 });
    const text = `${result.stdout}${result.stderr}`;
    if (result.code === 0 && /validated/i.test(text)) {
      return { paired: true, message: 'Device pairing is valid.' };
    }
    if (/password|passcode|locked/i.test(text)) {
      return { paired: false, message: 'Unlock the iPhone, then tap Trust when prompted.' };
    }
    if (/trust|dialog/i.test(text)) {
      return { paired: false, message: 'Tap Trust This Computer on the iPhone.' };
    }
    return { paired: false, message: text.trim() || 'Device is not paired with this workstation.' };
  }

  /** Global lockdown domain. */
  async info(udid: string): Promise<Record<string, unknown>> {
    const id = assertValidUdid(udid);
    const result = await run(TOOLS.info, ['-u', id, '-x'], {
      timeoutSeconds: this.timeoutSeconds,
    });
    if (result.code !== 0) throw toCollectionFailure('lockdown.global', result);
    return parseIdeviceInfo(result.stdout);
  }

  /** A scoped lockdown domain such as `com.apple.disk_usage`. */
  async domain(udid: string, domain: string): Promise<Record<string, unknown>> {
    const id = assertValidUdid(udid);
    if (!/^[a-zA-Z0-9._-]+$/.test(domain)) throw new Error(`Invalid lockdown domain: ${domain}`);
    const result = await run(TOOLS.info, ['-u', id, '-q', domain, '-x'], {
      timeoutSeconds: this.timeoutSeconds,
    });
    if (result.code !== 0) throw toCollectionFailure(`lockdown.${domain}`, result);
    return parseIdeviceInfo(result.stdout);
  }

  /**
   * IORegistry node via the diagnostics relay.
   *
   * Apple has progressively restricted this service on newer iOS builds, so a
   * refusal here is an expected outcome, not an error state — the caller falls
   * back to the analytics provider.
   */
  async ioregistry(udid: string, entryClass: string): Promise<Record<string, unknown>> {
    const id = assertValidUdid(udid);
    if (!/^[A-Za-z0-9_]+$/.test(entryClass)) {
      throw new Error(`Invalid IORegistry class: ${entryClass}`);
    }
    const result = await run(TOOLS.diagnostics, ['-u', id, 'ioregistry', entryClass], {
      timeoutSeconds: this.timeoutSeconds,
    });
    if (result.code !== 0) throw toCollectionFailure(`ioregistry.${entryClass}`, result);
    return parsePlistDict(result.stdout);
  }

  /** User-installed application bundle identifiers. */
  async installedApps(udid: string): Promise<string[]> {
    const id = assertValidUdid(udid);
    const result = await run(TOOLS.installer, ['-u', id, 'list', '-o', 'list_user'], {
      timeoutSeconds: this.timeoutSeconds,
    });
    if (result.code !== 0) throw toCollectionFailure('installation_proxy', result);
    return result.stdout
      .split(/\r?\n/)
      .map((line) => line.split(/[,\s]/)[0]?.trim() ?? '')
      .filter((id) => /^[a-zA-Z0-9][a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+$/.test(id));
  }

  /** Lockdown services the device advertises, used for integrity heuristics. */
  async services(udid: string): Promise<string[]> {
    const id = assertValidUdid(udid);
    try {
      const domain = await this.domain(id, 'com.apple.mobile.service_configuration');
      const keys = Object.keys(domain).filter((k) => k.startsWith('com.apple.'));
      if (keys.length > 0) return keys;
    } catch {
      // Not every iOS build exposes the service configuration domain.
    }
    // Probing for the unsandboxed AFC service a jailbreak installs is cheap and
    // is the single most valuable entry in this list.
    const probe = await run(TOOLS.info, ['-u', id, '-q', 'com.apple.afc2', '-x'], {
      timeoutSeconds: 8,
    });
    return probe.code === 0 && probe.stdout.includes('<dict>') ? ['com.apple.afc2'] : [];
  }

  /**
   * Copy aggregated analytics files off the device and extract battery keys.
   *
   * This is the fallback battery-health source and a parts signal source. The
   * files are pulled into a temporary directory, scanned, and deleted — DevDNA
   * never retains a customer's raw analytics.
   */
  async analytics(udid: string): Promise<AnalyticsExtract | null> {
    const id = assertValidUdid(udid);
    const dir = await mkdtemp(join(tmpdir(), 'devdna-analytics-'));
    try {
      const result = await run(TOOLS.crashReport, ['-u', id, '-e', '-k', dir], {
        timeoutSeconds: Math.max(this.timeoutSeconds, 60),
      });
      if (result.code !== 0 && !(await hasFiles(dir))) {
        throw toCollectionFailure('analytics.crashreport', result);
      }
      const files = await findAnalyticsFiles(dir);
      const extracts: AnalyticsExtract[] = [];
      for (const file of files) {
        try {
          const content = await readFile(file.path, 'utf8');
          extracts.push(extractAnalytics(file.name, content));
        } catch {
          // A single unreadable file must not abandon the whole harvest.
        }
      }
      return mergeAnalytics(extracts);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

async function hasFiles(dir: string): Promise<boolean> {
  try {
    return (await readdir(dir)).length > 0;
  } catch {
    return false;
  }
}

/** Aggregated analytics files, newest first, capped to bound the scan cost. */
async function findAnalyticsFiles(
  root: string,
  limit = 12,
): Promise<Array<{ name: string; path: string }>> {
  const found: Array<{ name: string; path: string }> = [];

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 4 || found.length >= limit * 4) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (/^log-aggregated.*\.ips$/i.test(entry.name) || /Analytics.*\.ips$/i.test(entry.name)) {
        found.push({ name: entry.name, path: full });
      }
    }
  };

  await walk(root, 0);
  return found.sort((a, b) => b.name.localeCompare(a.name)).slice(0, limit);
}

export class CollectionFailure extends Error {
  constructor(readonly detail: CollectionError) {
    super(detail.message);
    this.name = 'CollectionFailure';
  }
}

/** Turn a tool's exit into a typed, technician-readable collection error. */
function toCollectionFailure(collector: string, result: ExecResult): CollectionFailure {
  const text = `${result.stderr} ${result.stdout}`.trim();
  let code = CollectionErrorCode.UNKNOWN;

  if (result.timedOut) code = CollectionErrorCode.TIMEOUT;
  else if (/no device found|device not found/i.test(text)) code = CollectionErrorCode.NOT_PAIRED;
  else if (/pairing|trust|not paired/i.test(text)) code = CollectionErrorCode.NOT_PAIRED;
  else if (/passcode|locked/i.test(text)) code = CollectionErrorCode.DEVICE_LOCKED;
  else if (/denied|permission|not permitted/i.test(text)) code = CollectionErrorCode.PERMISSION_DENIED;
  else if (/could not start service|service.*unavailable|invalid service/i.test(text)) {
    code = CollectionErrorCode.SERVICE_UNAVAILABLE;
  } else if (/unsupported|not supported/i.test(text)) code = CollectionErrorCode.UNSUPPORTED_OS;

  return new CollectionFailure({
    collector,
    code,
    message: text || `${collector} failed with exit code ${result.code}`,
  });
}
