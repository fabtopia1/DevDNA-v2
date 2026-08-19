import {
  FailureReason,
  buildSimulatedSnapshot,
  type CollectionError,
  type RawDeviceSnapshot,
  type SimulatorProfileId,
} from '@devdna/core';
import { CollectionFailure, LibimobiledeviceAdapter } from '../adapters/libimobiledevice.js';
import { currentPlatform, type BridgeConfig } from '../config.js';

/**
 * Lockdown domains collected on every inspection, and why each one is needed.
 * Marked `required: false` means a refusal is normal and must not fail the run.
 */
export const COLLECTED_DOMAINS: Array<{ domain: string; purpose: string; required: boolean }> = [
  { domain: 'com.apple.disk_usage', purpose: 'storage capacity and free space', required: true },
  { domain: 'com.apple.mobile.battery', purpose: 'current charge level', required: true },
  {
    domain: 'com.apple.mobile.mobilegestalt',
    purpose: 'True Tone and Face ID capability probes',
    required: false,
  },
  { domain: 'com.apple.fmip', purpose: 'Find My / Activation Lock association', required: false },
  {
    domain: 'com.apple.mobile.cloud_configuration',
    purpose: 'MDM supervision and DEP enrolment',
    required: false,
  },
];

export type CollectionStage =
  | 'detect'
  | 'pairing'
  | 'identity'
  | 'domains'
  | 'battery'
  | 'applications'
  | 'analytics'
  | 'complete';

export interface CollectionProgress {
  stage: CollectionStage;
  label: string;
  /** 0-1 overall completion. */
  progress: number;
  ok: boolean;
  detail?: string;
}

export type ProgressListener = (progress: CollectionProgress) => void;

const STAGE_LABELS: Record<CollectionStage, string> = {
  detect: 'Detecting device',
  pairing: 'Verifying trust pairing',
  identity: 'Reading device identity',
  domains: 'Reading system domains',
  battery: 'Reading battery registry',
  applications: 'Listing installed applications',
  analytics: 'Harvesting analytics files',
  complete: 'Collection complete',
};

const STAGE_PROGRESS: Record<CollectionStage, number> = {
  detect: 0.05,
  pairing: 0.15,
  identity: 0.35,
  domains: 0.55,
  battery: 0.7,
  applications: 0.8,
  analytics: 0.95,
  complete: 1,
};

/**
 * Turns a physically connected iPhone into a `RawDeviceSnapshot`.
 *
 * The controlling principle: a collector that cannot read something records
 * *why* and carries on. A partial snapshot with honest gaps is useful; a failed
 * inspection with an exception is not. Only a device that is absent or
 * untrusted aborts the run, because there is genuinely nothing to collect.
 */
export class SnapshotCollector {
  private readonly adapter: LibimobiledeviceAdapter;

  constructor(private readonly config: BridgeConfig) {
    this.adapter = new LibimobiledeviceAdapter(config.toolTimeoutSeconds);
  }

  async collect(
    udid: string,
    onProgress: ProgressListener = () => undefined,
  ): Promise<RawDeviceSnapshot> {
    if (this.config.simulator) {
      return this.collectSimulated(udid as SimulatorProfileId, onProgress);
    }

    const errors: CollectionError[] = [];
    const emit = (stage: CollectionStage, ok = true, detail?: string): void =>
      onProgress({
        stage,
        label: STAGE_LABELS[stage],
        progress: STAGE_PROGRESS[stage],
        ok,
        ...(detail ? { detail } : {}),
      });

    const record = (error: unknown, collector: string): void => {
      if (error instanceof CollectionFailure) {
        errors.push(error.detail);
      } else {
        errors.push({
          collector,
          code: FailureReason.UNKNOWN,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    };

    emit('detect');
    const toolchain = await this.adapter.toolchain();
    if (toolchain.missing.length === Object.keys(toolchain.versions).length + toolchain.missing.length) {
      throw new Error(
        `No libimobiledevice tools found (${toolchain.missing.join(', ')}). ` +
          'Install the suite or start the bridge with --simulator.',
      );
    }

    emit('pairing');
    const pairing = await this.adapter.pairingStatus(udid);
    if (!pairing.paired) {
      // Nothing meaningful can be read without a trust pairing, so this is the
      // one condition that legitimately aborts the run.
      const failure = new Error(pairing.message);
      failure.name = 'NotPairedError';
      throw failure;
    }

    emit('identity');
    const lockdown = await this.adapter.info(udid);

    emit('domains');
    const domains: Record<string, Record<string, unknown>> = {};
    for (const entry of COLLECTED_DOMAINS) {
      try {
        domains[entry.domain] = await this.adapter.domain(udid, entry.domain);
      } catch (error) {
        record(error, `lockdown.${entry.domain}`);
        if (entry.required) emit('domains', false, `${entry.domain} unavailable`);
      }
    }

    emit('battery');
    const ioregistry: Record<string, Record<string, unknown>> = {};
    try {
      ioregistry['AppleSmartBattery'] = await this.adapter.ioregistry(udid, 'AppleSmartBattery');
    } catch (error) {
      record(error, 'battery.ioregistry');
      emit('battery', false, 'diagnostics relay declined; falling back to analytics');
    }

    emit('applications');
    let installedApps: string[] = [];
    try {
      installedApps = await this.adapter.installedApps(udid);
    } catch (error) {
      record(error, 'installation_proxy');
    }

    let services: string[] = [];
    try {
      services = await this.adapter.services(udid);
    } catch (error) {
      record(error, 'service_discovery');
    }

    let analytics = null;
    if (this.config.collectAnalytics) {
      emit('analytics');
      try {
        analytics = await this.adapter.analytics(udid);
      } catch (error) {
        record(error, 'analytics.crashreport');
        emit('analytics', false, 'no analytics files available');
      }
    }

    emit('complete');

    return {
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      bridge: {
        version: BRIDGE_VERSION,
        platform: currentPlatform(),
        toolchain: toolchain.versions,
        mode: 'usb',
      },
      lockdown,
      domains,
      ioregistry,
      analytics,
      installedApps,
      services,
      attestation: null,
      errors,
    };
  }

  /**
   * Simulator path. Replays a fixture with the same progress events as a real
   * capture so the dashboard, the API and the report generator are all
   * exercised identically with no handset present.
   */
  private async collectSimulated(
    profileId: SimulatorProfileId,
    onProgress: ProgressListener,
  ): Promise<RawDeviceSnapshot> {
    const stages: CollectionStage[] = [
      'detect',
      'pairing',
      'identity',
      'domains',
      'battery',
      'applications',
      'analytics',
      'complete',
    ];
    for (const stage of stages) {
      onProgress({
        stage,
        label: STAGE_LABELS[stage],
        progress: STAGE_PROGRESS[stage],
        ok: true,
      });
      await sleep(90);
    }
    const snapshot = buildSimulatedSnapshot(profileId);
    return {
      ...snapshot,
      capturedAt: new Date().toISOString(),
      bridge: { ...snapshot.bridge, version: BRIDGE_VERSION, platform: currentPlatform() },
    };
  }
}

export const BRIDGE_VERSION = '0.1.0';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
