import { EventEmitter } from 'node:events';
import { SIMULATOR_PROFILES } from '@devdna/core';
import { LibimobiledeviceAdapter, type ConnectedDevice } from '../adapters/libimobiledevice.js';
import type { BridgeConfig } from '../config.js';

export interface WatchedDevice extends ConnectedDevice {
  /** Populated lazily so the device list can render before a full read. */
  deviceName: string | null;
  productType: string | null;
  productVersion: string | null;
  paired: boolean;
  pairingMessage: string;
  firstSeenAt: string;
}

/**
 * Polls usbmuxd for attached devices and emits connect/disconnect events.
 *
 * Polling rather than a libusb hotplug subscription: usbmuxd already
 * multiplexes device state, polling it costs nothing at a 2s interval, and it
 * behaves identically on macOS and Windows — where the driver stack differs
 * enough that hotplug callbacks are a portability liability.
 */
export class DeviceWatcher extends EventEmitter {
  private readonly adapter: LibimobiledeviceAdapter;
  private timer: NodeJS.Timeout | null = null;
  private devices = new Map<string, WatchedDevice>();
  private polling = false;

  constructor(
    private readonly config: BridgeConfig,
    private readonly intervalMs = 2000,
  ) {
    super();
    this.adapter = new LibimobiledeviceAdapter(config.toolTimeoutSeconds);
  }

  start(): void {
    if (this.timer) return;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
    // Never hold the process open purely to keep polling.
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  list(): WatchedDevice[] {
    return [...this.devices.values()];
  }

  get(udid: string): WatchedDevice | undefined {
    return this.devices.get(udid);
  }

  private async poll(): Promise<void> {
    // Guard against overlapping polls when a device read runs long.
    if (this.polling) return;
    this.polling = true;
    try {
      const attached = this.config.simulator
        ? simulatedDevices()
        : await this.enumerate();

      const seen = new Set(attached.map((d) => d.udid));

      for (const device of attached) {
        if (!this.devices.has(device.udid)) {
          this.devices.set(device.udid, device);
          this.emit('connect', device);
        }
      }

      for (const udid of [...this.devices.keys()]) {
        if (!seen.has(udid)) {
          const device = this.devices.get(udid);
          this.devices.delete(udid);
          this.emit('disconnect', device);
        }
      }
    } catch (error) {
      this.emit('error', error);
    } finally {
      this.polling = false;
    }
  }

  private async enumerate(): Promise<WatchedDevice[]> {
    const found = await this.adapter.listDevices();
    return Promise.all(
      found.map(async (device) => {
        const existing = this.devices.get(device.udid);
        if (existing) return existing;

        const pairing = await this.adapter.pairingStatus(device.udid).catch(() => ({
          paired: false,
          message: 'Pairing state unknown.',
        }));

        let deviceName: string | null = null;
        let productType: string | null = null;
        let productVersion: string | null = null;

        // Only a paired device answers property reads; an unpaired one still
        // appears in the list so the UI can prompt for Trust.
        if (pairing.paired) {
          try {
            const info = await this.adapter.info(device.udid);
            deviceName = (info['DeviceName'] as string) ?? null;
            productType = (info['ProductType'] as string) ?? null;
            productVersion = (info['ProductVersion'] as string) ?? null;
          } catch {
            // Preview details are best-effort.
          }
        }

        return {
          ...device,
          deviceName,
          productType,
          productVersion,
          paired: pairing.paired,
          pairingMessage: pairing.message,
          firstSeenAt: new Date().toISOString(),
        };
      }),
    );
  }
}

/** In simulator mode each fixture profile presents as an attached handset. */
function simulatedDevices(): WatchedDevice[] {
  return SIMULATOR_PROFILES.map((profile) => {
    const snapshot = profile.build();
    return {
      udid: profile.id,
      connection: 'usb' as const,
      deviceName: (snapshot.lockdown['DeviceName'] as string) ?? profile.label,
      productType: (snapshot.lockdown['ProductType'] as string) ?? null,
      productVersion: (snapshot.lockdown['ProductVersion'] as string) ?? null,
      paired: true,
      pairingMessage: 'Simulated device.',
      firstSeenAt: new Date().toISOString(),
    };
  });
}
