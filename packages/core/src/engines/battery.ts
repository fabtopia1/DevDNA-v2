import {
  clamp,
  DataSource,
  lerp,
  observe,
  round,
  Severity,
  type Finding,
  type MaybeObservation,
  type Observation,
} from '../types/common.js';
import {
  BatteryCondition,
  ChargingState,
  type BatteryAssessment,
} from '../types/battery.js';
import type { RawDeviceSnapshot } from '../types/device.js';
import { asBoolean, asNumber, asString, pick } from '../parsers/ideviceinfo.js';
import { parseSmartBattery, type SmartBatteryReading } from '../parsers/ioregistry.js';
import { resolveDevice } from '../catalog/devices.js';

const BATTERY_DOMAIN = 'com.apple.mobile.battery';

/**
 * Weights of the three battery sub-scores. Health dominates because it is what
 * the resale market actually prices; cycles are a leading indicator of future
 * health, and condition flags capture Apple's own service recommendation.
 */
export const BATTERY_WEIGHTS = { health: 0.72, cycles: 0.2, condition: 0.08 } as const;

/**
 * Piecewise health curve, calibrated against how the trade actually values a
 * cell rather than as a straight percentage:
 *
 *   100% -> 100 | 95% -> 94 | 93% -> 91.6 | 90% -> 88 | 85% -> 74 | 80% -> 60
 *    75% -> 45  | 70% -> 30 | 60% -> 15   | <=50% -> 0
 *
 * The gradient steepens below 80% because that is Apple's own
 * "Service Recommended" threshold and the point at which a shop must price in
 * a replacement.
 */
export function batteryHealthComponent(maxCapacityPercent: number): number {
  const mc = clamp(maxCapacityPercent, 0, 100);
  if (mc >= 100) return 100;
  if (mc >= 90) return lerp(mc, 90, 100, 88, 100);
  if (mc >= 80) return lerp(mc, 80, 90, 60, 88);
  if (mc >= 70) return lerp(mc, 70, 80, 30, 60);
  if (mc >= 50) return lerp(mc, 50, 70, 0, 30);
  return 0;
}

/**
 * Cycle curve, normalised against the model's rated cycle life (1000 for
 * iPhone 15 and later, 500 before). A cell at its rated life still works, so
 * the floor is 10 rather than 0.
 */
export function batteryCycleComponent(cycles: number, ratedCycleLife: number): number {
  const rated = ratedCycleLife > 0 ? ratedCycleLife : 500;
  const ratio = Math.max(0, cycles) / rated;
  if (ratio <= 1) return clamp(100 - 55 * ratio, 45, 100);
  return clamp(45 - 35 * (ratio - 1), 10, 45);
}

interface BatterySource {
  source: DataSource;
  confidence: number;
  designCapacityMah: number | null;
  nominalChargeCapacityMah: number | null;
  cycleCount: number | null;
  maximumCapacityPercent: number | null;
  serial: string | null;
  note: string;
}

/**
 * Ordered provider chain. The first provider that yields a usable value for a
 * field wins, and the winning provider's identity is carried into the report so
 * a buyer can see whether a health figure came from the device's own registry
 * or from an analytics file.
 */
function collectSources(snapshot: RawDeviceSnapshot): BatterySource[] {
  const sources: BatterySource[] = [];

  // 1. Diagnostics relay IORegistry — highest fidelity where still permitted.
  const ioNode = snapshot.ioregistry['AppleSmartBattery'];
  if (ioNode && Object.keys(ioNode).length > 0) {
    const reading: SmartBatteryReading = parseSmartBattery(ioNode);
    sources.push({
      source: DataSource.DIAGNOSTICS_RELAY,
      confidence: 0.92,
      designCapacityMah: reading.designCapacityMah,
      nominalChargeCapacityMah:
        reading.nominalChargeCapacityMah ?? reading.appleRawMaxCapacityMah,
      cycleCount: reading.cycleCount,
      maximumCapacityPercent: null,
      serial: reading.serial,
      note: 'AppleSmartBattery IORegistry node via com.apple.mobile.diagnostics_relay',
    });
  }

  // 2. Aggregated analytics files copied over com.apple.crashreportcopymobile.
  const keys = snapshot.analytics?.batteryKeys;
  if (keys && Object.keys(keys).length > 0) {
    sources.push({
      source: DataSource.ANALYTICS_LOG,
      confidence: 0.72,
      designCapacityMah: asNumber(keys['designCapacityMah']),
      nominalChargeCapacityMah: asNumber(keys['nominalChargeCapacityMah']),
      cycleCount: asNumber(keys['cycleCount']),
      maximumCapacityPercent: asNumber(keys['maximumCapacityPercent']),
      serial: asString(keys['batterySerial']),
      note: `aggregated analytics ${snapshot.analytics?.sourceFile ?? ''}`.trim(),
    });
  }

  return sources;
}

function firstOf<T>(
  sources: BatterySource[],
  read: (s: BatterySource) => T | null,
  observedAt: string,
): MaybeObservation<T> {
  for (const source of sources) {
    const value = read(source);
    if (value !== null && value !== undefined) {
      return observe(value, source.source, {
        confidence: source.confidence,
        observedAt,
        note: source.note,
      });
    }
  }
  return null;
}

export function assessBattery(snapshot: RawDeviceSnapshot): BatteryAssessment {
  const at = snapshot.capturedAt;
  const device = resolveDevice(snapshot.lockdown['ProductType'] as string | undefined);
  const sources = collectSources(snapshot);
  const findings: Finding[] = [];

  const designCapacityMah = firstOf(sources, (s) => s.designCapacityMah, at);
  const nominalChargeCapacityMah = firstOf(sources, (s) => s.nominalChargeCapacityMah, at);
  const cycleCount = firstOf(sources, (s) => s.cycleCount, at);
  const batterySerial = firstOf(sources, (s) => s.serial, at);

  // Maximum Capacity: prefer a directly reported percentage, otherwise compute
  // it the way Apple does (nominal charge capacity / design capacity).
  let maximumCapacityPercent: MaybeObservation<number> = firstOf(
    sources,
    (s) => s.maximumCapacityPercent,
    at,
  );
  if (!maximumCapacityPercent && designCapacityMah && nominalChargeCapacityMah) {
    const design = designCapacityMah.value;
    const nominal = nominalChargeCapacityMah.value;
    if (design > 0 && nominal > 0) {
      maximumCapacityPercent = observe(
        clamp(round((nominal / design) * 100), 0, 100),
        DataSource.DERIVED,
        {
          confidence: Math.min(designCapacityMah.confidence, nominalChargeCapacityMah.confidence) * 0.98,
          observedAt: at,
          note: 'NominalChargeCapacity / DesignCapacity, Apple’s own Maximum Capacity formula',
        },
      );
    }
  }

  // Current charge level. Available from the plain lockdown battery domain on
  // every supported iOS release. It is not a health metric and never scores.
  const batteryDomain = snapshot.domains[BATTERY_DOMAIN] ?? {};
  const chargeRaw = asNumber(pick(batteryDomain, 'BatteryCurrentCapacity'));
  const currentChargePercent: MaybeObservation<number> =
    chargeRaw === null
      ? null
      : observe(clamp(chargeRaw, 0, 100), DataSource.LOCKDOWN_DOMAIN, {
          observedAt: at,
          note: `${BATTERY_DOMAIN} BatteryCurrentCapacity`,
        });

  const isCharging = asBoolean(pick(batteryDomain, 'BatteryIsCharging'));
  const fullyCharged = asBoolean(pick(batteryDomain, 'FullyCharged'));
  const chargingState: ChargingState = fullyCharged
    ? ChargingState.FULLY_CHARGED
    : isCharging === true
      ? ChargingState.CHARGING
      : isCharging === false
        ? ChargingState.DISCHARGING
        : ChargingState.UNKNOWN;

  const mc = maximumCapacityPercent?.value ?? null;
  const condition: BatteryCondition =
    mc === null
      ? BatteryCondition.UNKNOWN
      : mc < 70
        ? BatteryCondition.DEGRADED
        : mc < 80
          ? BatteryCondition.SERVICE_RECOMMENDED
          : BatteryCondition.NORMAL;

  const healthComponent = mc === null ? null : batteryHealthComponent(mc);
  const cycleComponent =
    cycleCount === null ? null : batteryCycleComponent(cycleCount.value, device.ratedCycleLife);
  const conditionComponent =
    condition === BatteryCondition.NORMAL
      ? 100
      : condition === BatteryCondition.SERVICE_RECOMMENDED
        ? 45
        : condition === BatteryCondition.DEGRADED
          ? 10
          : 50;

  // Renormalise across the sub-scores we actually have, so a missing cycle
  // count lowers confidence instead of silently scoring zero.
  const parts: Array<{ name: string; value: number; weight: number }> = [];
  if (healthComponent !== null) {
    parts.push({ name: 'health', value: healthComponent, weight: BATTERY_WEIGHTS.health });
  }
  if (cycleComponent !== null) {
    parts.push({ name: 'cycles', value: cycleComponent, weight: BATTERY_WEIGHTS.cycles });
  }
  if (mc !== null) {
    parts.push({ name: 'condition', value: conditionComponent, weight: BATTERY_WEIGHTS.condition });
  }

  const totalWeight = parts.reduce((sum, p) => sum + p.weight, 0);
  const score =
    totalWeight > 0
      ? round(clamp(parts.reduce((sum, p) => sum + p.value * p.weight, 0) / totalWeight))
      : 0;

  const contributing: Array<Observation<unknown> | null> = [
    maximumCapacityPercent as Observation<unknown> | null,
    cycleCount as Observation<unknown> | null,
  ];
  const present = contributing.filter((o): o is Observation<unknown> => o !== null);
  // No health data at all means no defensible battery score.
  const coverage = present.length / contributing.length;
  const confidence =
    present.length === 0
      ? 0
      : round(
          (present.reduce((sum, o) => sum + o.confidence, 0) / present.length) *
            (0.55 + 0.45 * coverage),
          3,
        );

  if (mc === null) {
    findings.push({
      code: 'BATTERY_HEALTH_UNAVAILABLE',
      severity: Severity.MEDIUM,
      title: 'Battery health could not be read',
      detail:
        'Neither the diagnostics relay nor the analytics files returned capacity data. ' +
        'On recent iOS builds this usually means the diagnostics service declined the ' +
        'query and the device has no aggregated analytics stored. Read Maximum Capacity ' +
        'from Settings > Battery > Battery Health and attach it as an attestation.',
      source: DataSource.DERIVED,
    });
  }
  if (cycleCount === null) {
    findings.push({
      code: 'BATTERY_CYCLES_UNAVAILABLE',
      severity: Severity.LOW,
      title: 'Cycle count could not be read',
      detail:
        'Cycle count is only exposed through the diagnostics relay and analytics files. ' +
        'The battery score was computed from health alone.',
      source: DataSource.DERIVED,
    });
  }
  if (condition === BatteryCondition.SERVICE_RECOMMENDED) {
    findings.push({
      code: 'BATTERY_SERVICE_RECOMMENDED',
      severity: Severity.MEDIUM,
      title: `Battery at ${mc}% maximum capacity`,
      detail:
        'Below Apple’s 80% service threshold. Expect reduced runtime and price in a ' +
        'replacement cell.',
      source: maximumCapacityPercent?.source ?? DataSource.DERIVED,
    });
  }
  if (condition === BatteryCondition.DEGRADED) {
    findings.push({
      code: 'BATTERY_DEGRADED',
      severity: Severity.HIGH,
      title: `Battery severely degraded at ${mc}%`,
      detail: 'The cell has lost more than 30% of its original capacity and needs replacing.',
      source: maximumCapacityPercent?.source ?? DataSource.DERIVED,
    });
  }
  if (cycleCount && cycleCount.value > device.ratedCycleLife) {
    findings.push({
      code: 'BATTERY_CYCLES_EXCEEDED',
      severity: Severity.MEDIUM,
      title: `Cycle count ${cycleCount.value} exceeds the ${device.ratedCycleLife}-cycle rating`,
      detail: 'The cell is past the cycle life Apple rates for this model.',
      source: cycleCount.source,
    });
  }

  return {
    maximumCapacityPercent,
    cycleCount,
    designCapacityMah,
    nominalChargeCapacityMah,
    currentChargePercent,
    chargingState,
    condition,
    batterySerial,
    ratedCycleLife: device.ratedCycleLife,
    score,
    confidence,
    breakdown: {
      healthComponent: healthComponent === null ? null : round(healthComponent, 2),
      cycleComponent: cycleComponent === null ? null : round(cycleComponent, 2),
      conditionComponent,
      weightsApplied: Object.fromEntries(
        parts.map((p) => [p.name, round(p.weight / (totalWeight || 1), 3)]),
      ),
    },
    findings,
    sourcesUsed: [...new Set(sources.map((s) => s.source))],
  };
}
