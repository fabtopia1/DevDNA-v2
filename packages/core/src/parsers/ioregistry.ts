import { parsePlistDict } from './plist.js';
import { asNumber, asString, pick } from './ideviceinfo.js';

/**
 * Normalised view of the `AppleSmartBattery` IORegistry node, reached via the
 * public `com.apple.mobile.diagnostics_relay` service
 * (`idevicediagnostics ioregistry AppleSmartBattery`).
 *
 * Availability caveat, by design not by accident: Apple progressively
 * restricted diagnostics_relay IORegistry access on modern iOS. When the
 * service refuses, the battery engine falls back to the analytics provider —
 * see `docs/06-softwaredna-engine.md`.
 */
export interface SmartBatteryReading {
  designCapacityMah: number | null;
  /** Apple's own "maximum capacity" numerator on modern iOS. */
  nominalChargeCapacityMah: number | null;
  /** Older field, used when NominalChargeCapacity is absent. */
  appleRawMaxCapacityMah: number | null;
  cycleCount: number | null;
  currentChargePercent: number | null;
  serial: string | null;
  manufactureDate: string | null;
  isCharging: boolean | null;
  fullyCharged: boolean | null;
  externalConnected: boolean | null;
  /** Battery temperature in Celsius, when exposed. */
  temperatureCelsius: number | null;
  raw: Record<string, unknown>;
}

/**
 * Some builds nest the payload under the node name, some return it flat, and
 * `idevicediagnostics` sometimes wraps everything in a `Status`/`Diagnostics`
 * envelope. Unwrap all three shapes before reading keys.
 */
export function unwrapIoRegistryPayload(root: Record<string, unknown>): Record<string, unknown> {
  let node: Record<string, unknown> = root;
  for (const key of ['Diagnostics', 'IORegistry', 'AppleSmartBattery']) {
    const child = node[key];
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      node = child as Record<string, unknown>;
    }
  }
  return node;
}

export function parseSmartBattery(input: string | Record<string, unknown>): SmartBatteryReading {
  const root = typeof input === 'string' ? parsePlistDict(input) : input;
  const node = unwrapIoRegistryPayload(root as Record<string, unknown>);

  const temperatureRaw = asNumber(pick(node, 'Temperature', 'VirtualTemperature'));

  return {
    designCapacityMah: asNumber(pick(node, 'DesignCapacity')),
    nominalChargeCapacityMah: asNumber(pick(node, 'NominalChargeCapacity')),
    appleRawMaxCapacityMah: asNumber(pick(node, 'AppleRawMaxCapacity', 'MaxCapacity')),
    cycleCount: asNumber(pick(node, 'CycleCount')),
    currentChargePercent: asNumber(pick(node, 'CurrentCapacity', 'BatteryCurrentCapacity')),
    serial: asString(pick(node, 'Serial', 'BatterySerialNumber', 'SerialNumber')),
    manufactureDate: asString(pick(node, 'ManufactureDate', 'BatteryManufactureDate')),
    isCharging: toBool(pick(node, 'IsCharging')),
    fullyCharged: toBool(pick(node, 'FullyCharged')),
    externalConnected: toBool(pick(node, 'ExternalConnected', 'ExternalChargeCapable')),
    // IORegistry reports deci-Celsius (e.g. 2980 => 29.8 C).
    temperatureCelsius:
      temperatureRaw === null ? null : temperatureRaw > 200 ? temperatureRaw / 100 : temperatureRaw,
    raw: node,
  };
}

function toBool(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return null;
}
