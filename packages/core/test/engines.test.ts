import { describe, expect, it } from 'vitest';
import {
  applicableComponents,
  assessBattery,
  assessIdentity,
  assessParts,
  assessSoftware,
  assessTrust,
  batteryCycleComponent,
  batteryHealthComponent,
  BatteryCondition,
  buildSimulatedSnapshot,
  DataSource,
  inferMarketingCapacityGb,
  PartComponent,
  PartVerdict,
  resolveDevice,
  resolveRegion,
  resolveVerdict,
  SignalPolarity,
  VerificationStatus,
  type PartSignal,
  type RawDeviceSnapshot,
} from '../src/index.js';

const signal = (over: Partial<PartSignal> = {}): PartSignal => ({
  id: 'test',
  component: PartComponent.DISPLAY,
  polarity: SignalPolarity.SUPPORTS_GENUINE,
  source: DataSource.TECHNICIAN_ATTESTATION,
  strength: 0.9,
  confidence: 0.9,
  summary: 'test signal',
  ...over,
});

describe('device catalog', () => {
  it('resolves known product types', () => {
    expect(resolveDevice('iPhone16,1').marketingName).toBe('iPhone 15 Pro');
    expect(resolveDevice('iPhone16,1').ratedCycleLife).toBe(1000);
    expect(resolveDevice('iPhone14,5').ratedCycleLife).toBe(500);
  });

  it('degrades gracefully for unknown product types instead of guessing a name', () => {
    const unknown = resolveDevice('iPhone19,4');
    expect(unknown.recognised).toBe(false);
    expect(unknown.marketingName).toBe('iPhone (iPhone19,4)');
    // Newer silicon is assumed at least as capable as the newest catalogued model.
    expect(unknown.ratedCycleLife).toBe(1000);
  });

  it('excludes components the model does not have', () => {
    const se = applicableComponents(resolveDevice('iPhone14,6'));
    expect(se).toContain(PartComponent.TOUCH_ID);
    expect(se).not.toContain(PartComponent.FACE_ID);
    expect(se).not.toContain(PartComponent.LIDAR);

    const pro = applicableComponents(resolveDevice('iPhone16,1'));
    expect(pro).toContain(PartComponent.FACE_ID);
    expect(pro).toContain(PartComponent.LIDAR);
  });

  it('snaps raw disk capacity up to the marketing tier', () => {
    expect(inferMarketingCapacityGb(256_000_000_000)).toBe(256);
    expect(inferMarketingCapacityGb(119_000_000_000)).toBe(128);
    expect(inferMarketingCapacityGb(null)).toBeNull();
  });

  it('resolves region codes and returns null for unmapped ones', () => {
    expect(resolveRegion('LL/A').name).toBe('United States');
    expect(resolveRegion('ZP/A').name).toBe('Hong Kong / Macao');
    expect(resolveRegion('QQ/A').name).toBeNull();
    expect(resolveRegion(null).code).toBeNull();
  });
});

describe('battery scoring curves', () => {
  it('is monotonic in health', () => {
    for (let mc = 1; mc <= 100; mc += 1) {
      expect(batteryHealthComponent(mc)).toBeGreaterThanOrEqual(batteryHealthComponent(mc - 1));
    }
  });

  it('hits the calibration points the algorithm doc publishes', () => {
    expect(batteryHealthComponent(100)).toBe(100);
    expect(batteryHealthComponent(90)).toBeCloseTo(88, 5);
    expect(batteryHealthComponent(80)).toBeCloseTo(60, 5);
    expect(batteryHealthComponent(70)).toBeCloseTo(30, 5);
    expect(batteryHealthComponent(50)).toBeCloseTo(0, 5);
    expect(batteryHealthComponent(20)).toBe(0);
  });

  it('normalises cycles against the model rating and never returns zero', () => {
    expect(batteryCycleComponent(0, 1000)).toBe(100);
    expect(batteryCycleComponent(500, 1000)).toBeCloseTo(72.5, 1);
    expect(batteryCycleComponent(1000, 1000)).toBe(45);
    expect(batteryCycleComponent(2000, 1000)).toBe(10);
    // A 500-cycle cell at 500 cycles scores the same as a 1000-cycle cell at 1000.
    expect(batteryCycleComponent(500, 500)).toBe(batteryCycleComponent(1000, 1000));
  });
});

describe('battery assessment', () => {
  it('derives Apple maximum capacity from the registry and scores it', () => {
    const battery = assessBattery(buildSimulatedSnapshot('pristine-15-pro'));
    expect(battery.maximumCapacityPercent?.value).toBe(99);
    expect(battery.cycleCount?.value).toBe(42);
    expect(battery.condition).toBe(BatteryCondition.NORMAL);
    expect(battery.score).toBeGreaterThanOrEqual(95);
    expect(battery.confidence).toBeGreaterThan(0.8);
    expect(battery.maximumCapacityPercent?.source).toBe(DataSource.DERIVED);
  });

  it('flags a cell below the Apple service threshold', () => {
    const battery = assessBattery(buildSimulatedSnapshot('counterfeit-display-13'));
    expect(battery.maximumCapacityPercent?.value).toBe(76);
    expect(battery.condition).toBe(BatteryCondition.SERVICE_RECOMMENDED);
    expect(battery.findings.map((f) => f.code)).toContain('BATTERY_SERVICE_RECOMMENDED');
    expect(battery.findings.map((f) => f.code)).toContain('BATTERY_CYCLES_EXCEEDED');
  });

  it('reports zero confidence and raises findings when no health source answers', () => {
    const battery = assessBattery(buildSimulatedSnapshot('legacy-sparse-8'));
    expect(battery.maximumCapacityPercent).toBeNull();
    expect(battery.cycleCount).toBeNull();
    expect(battery.confidence).toBe(0);
    expect(battery.findings.map((f) => f.code)).toContain('BATTERY_HEALTH_UNAVAILABLE');
    // Current charge is still readable from the plain lockdown battery domain.
    expect(battery.currentChargePercent?.value).toBe(29);
  });

  it('falls back to the analytics provider when the registry is missing', () => {
    const base = buildSimulatedSnapshot('serviced-14-pro');
    const withoutRegistry: RawDeviceSnapshot = { ...base, ioregistry: {} };
    const battery = assessBattery(withoutRegistry);
    expect(battery.cycleCount?.value).toBe(412);
    expect(battery.cycleCount?.source).toBe(DataSource.ANALYTICS_LOG);
    // Lower-fidelity source must lower confidence.
    expect(battery.confidence).toBeLessThan(assessBattery(base).confidence);
  });
});

describe('software assessment', () => {
  it('scores a current, uncluttered device highly', () => {
    const software = assessSoftware(buildSimulatedSnapshot('pristine-15-pro'));
    expect(software.score).toBe(100);
    expect(software.jailbreakSuspected).toBe(false);
    expect(software.storage.usedPercent).toBeCloseTo(15, 0);
  });

  it('does not penalise a device already on the newest train it supports', () => {
    // The iPhone 8 fixture runs 16.7.11 and cannot go past iOS 16.
    const software = assessSoftware(buildSimulatedSnapshot('legacy-sparse-8'));
    expect(software.majorVersionsBehind).toBe(0);
    expect(software.findings.map((f) => f.code)).not.toContain('IOS_MAJOR_BEHIND');
  });

  it('penalises an out-of-date and unsupported iOS train', () => {
    const base = buildSimulatedSnapshot('legacy-sparse-8');
    const stale: RawDeviceSnapshot = {
      ...base,
      lockdown: { ...base.lockdown, ProductVersion: '14.8.1', BuildVersion: '18H107' },
    };
    const software = assessSoftware(stale);
    const codes = software.findings.map((f) => f.code);
    expect(software.majorVersionsBehind).toBe(2);
    expect(codes).toContain('IOS_MAJOR_BEHIND');
    expect(codes).toContain('IOS_UNSUPPORTED');
    expect(software.score).toBeLessThan(85);
  });

  it('flags nearly-full storage', () => {
    const software = assessSoftware(buildSimulatedSnapshot('legacy-sparse-8'));
    expect(software.storage.usedPercent).toBeGreaterThan(90);
    expect(software.findings.map((f) => f.code)).toContain('STORAGE_LOW');
  });

  it('lowers confidence when the diagnostics relay does not answer', () => {
    const withRelay = assessSoftware(buildSimulatedSnapshot('pristine-15-pro'));
    const withoutRelay = assessSoftware(buildSimulatedSnapshot('legacy-sparse-8'));
    expect(withoutRelay.diagnosticsAvailable).toBe(false);
    expect(withoutRelay.confidence).toBeLessThan(withRelay.confidence);
    expect(withoutRelay.findings.map((f) => f.code)).toContain('DIAGNOSTICS_UNAVAILABLE');
  });

  it('detects jailbreak indicators from apps and services', () => {
    const base = buildSimulatedSnapshot('pristine-15-pro');
    const jailbroken: RawDeviceSnapshot = {
      ...base,
      installedApps: ['com.saurik.Cydia'],
      services: [...base.services, 'com.apple.afc2'],
    };
    const software = assessSoftware(jailbroken);
    expect(software.jailbreakSuspected).toBe(true);
    expect(software.jailbreakIndicators).toHaveLength(2);
    expect(software.score).toBeLessThanOrEqual(55);
  });
});

describe('parts rule engine', () => {
  it('never concludes genuine from an absence of evidence', () => {
    const { verdict, confidence } = resolveVerdict([]);
    expect(verdict).toBe(PartVerdict.CANNOT_DETERMINE);
    expect(confidence).toBe(0);
  });

  it('lets a single strong non-genuine signal outweigh weak genuine ones', () => {
    const { verdict } = resolveVerdict([
      signal({ polarity: SignalPolarity.SUPPORTS_UNKNOWN, strength: 0.85, confidence: 0.72 }),
      signal({ polarity: SignalPolarity.SUPPORTS_GENUINE, strength: 0.4, confidence: 0.8 }),
    ]);
    expect(verdict).toBe(PartVerdict.UNKNOWN_PART);
  });

  it('returns UNVERIFIED when the evidence conflicts evenly', () => {
    const { verdict } = resolveVerdict([
      signal({ polarity: SignalPolarity.SUPPORTS_GENUINE, strength: 0.5, confidence: 0.8 }),
      signal({ polarity: SignalPolarity.SUPPORTS_SERVICED, strength: 0.5, confidence: 0.8 }),
    ]);
    expect(verdict).toBe(PartVerdict.UNVERIFIED_PART);
  });

  it('reads Apple wording straight off an attestation', () => {
    const parts = assessParts(buildSimulatedSnapshot('serviced-14-pro'));
    const byComponent = new Map(parts.results.map((r) => [r.component, r]));
    expect(byComponent.get(PartComponent.DISPLAY)?.verdict).toBe(PartVerdict.GENUINE_APPLE_PART);
    expect(byComponent.get(PartComponent.BATTERY)?.verdict).toBe(PartVerdict.USED_APPLE_PART);
    expect(byComponent.get(PartComponent.REAR_CAMERA)?.verdict).toBe(PartVerdict.GENUINE_APPLE_PART);
    expect(parts.attestationPresent).toBe(true);
  });

  it('catches third-party parts and raises critical findings', () => {
    const parts = assessParts(buildSimulatedSnapshot('counterfeit-display-13'));
    const byComponent = new Map(parts.results.map((r) => [r.component, r]));
    expect(byComponent.get(PartComponent.DISPLAY)?.verdict).toBe(PartVerdict.UNKNOWN_PART);
    expect(byComponent.get(PartComponent.BATTERY)?.verdict).toBe(PartVerdict.UNKNOWN_PART);
    expect(parts.score).toBeLessThan(50);
    expect(parts.findings.map((f) => f.code)).toContain('PART_UNKNOWN_DISPLAY');
  });

  it('marks unassessable components CANNOT_DETERMINE and reports coverage', () => {
    const parts = assessParts(buildSimulatedSnapshot('legacy-sparse-8'));
    expect(parts.results.every((r) => r.verdict === PartVerdict.CANNOT_DETERMINE)).toBe(true);
    expect(parts.coverage).toBe(0);
    expect(parts.confidence).toBe(0);
    expect(parts.findings.map((f) => f.code)).toContain('PARTS_COVERAGE_LOW');
  });
});

describe('trust engine', () => {
  const build = (id: Parameters<typeof buildSimulatedSnapshot>[0]) => {
    const snapshot = buildSimulatedSnapshot(id);
    const { identity } = assessIdentity(snapshot);
    return {
      identity,
      battery: assessBattery(snapshot),
      software: assessSoftware(snapshot),
      parts: assessParts(snapshot),
    };
  };

  it('weights parts most heavily when the pillars are equally trustworthy', () => {
    const input = build('pristine-15-pro');
    const equalConfidence = {
      ...input,
      battery: { ...input.battery, confidence: 0.9 },
      software: { ...input.software, confidence: 0.9 },
      parts: { ...input.parts, confidence: 0.9 },
    };
    const trust = assessTrust(equalConfidence);
    expect(trust.inputs.parts.weight).toBeGreaterThan(trust.inputs.battery.weight);
    expect(trust.inputs.battery.weight).toBeGreaterThan(trust.inputs.software.weight);
  });

  it('always renormalises the effective weights to 1', () => {
    for (const id of ['pristine-15-pro', 'counterfeit-display-13', 'legacy-sparse-8'] as const) {
      const trust = assessTrust(build(id));
      const total =
        trust.inputs.parts.weight + trust.inputs.battery.weight + trust.inputs.software.weight;
      expect(total).toBeCloseTo(1, 2);
    }
  });

  it('shifts weight away from a pillar it cannot trust', () => {
    const input = build('pristine-15-pro');
    const confident = assessTrust(input);
    const doubtful = assessTrust({ ...input, parts: { ...input.parts, confidence: 0.1 } });
    expect(doubtful.inputs.parts.weight).toBeLessThan(confident.inputs.parts.weight);
    expect(doubtful.inputs.battery.weight).toBeGreaterThan(confident.inputs.battery.weight);
  });

  it('caps the score when Activation Lock is on, whatever the condition', () => {
    const trust = assessTrust(build('activation-locked-12'));
    expect(trust.gatesApplied.map((g) => g.code)).toContain('ACTIVATION_LOCK_ON');
    expect(trust.gatesApplied.map((g) => g.code)).toContain('MDM_SUPERVISED');
    expect(trust.score).toBeLessThanOrEqual(35);
    expect(trust.score).toBeLessThan(trust.rawScore);
    expect(trust.status).toBe(VerificationStatus.FLAGGED);
  });

  it('flags a device with non-genuine critical parts', () => {
    const trust = assessTrust(build('counterfeit-display-13'));
    expect(trust.gatesApplied.map((g) => g.code)).toContain('CRITICAL_PART_UNKNOWN');
    expect(trust.status).toBe(VerificationStatus.FLAGGED);
  });

  it('refuses to certify a low-confidence inspection', () => {
    const trust = assessTrust(build('legacy-sparse-8'));
    expect(trust.status).toBe(VerificationStatus.INCONCLUSIVE);
  });

  it('passes a clean device without any serious gate firing', () => {
    const trust = assessTrust(build('pristine-15-pro'));
    expect(trust.status).toBe(VerificationStatus.VERIFIED);
    expect(trust.score).toBeGreaterThanOrEqual(85);
    expect(trust.gatesApplied.every((g) => g.cap >= 95)).toBe(true);
  });

  it('withholds a perfect score when component coverage is partial', () => {
    const trust = assessTrust(build('pristine-15-pro'));
    expect(trust.rawScore).toBe(100);
    expect(trust.score).toBeLessThan(100);
    expect(trust.gatesApplied.map((g) => g.code)).toContain('PARTS_COVERAGE_PARTIAL');
  });
});
