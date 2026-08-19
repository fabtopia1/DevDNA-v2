import { describe, expect, it } from 'vitest';
import {
  buildSimulatedSnapshot,
  collectEvidence,
  CollectionMethod,
  decodeImei,
  decodeModelNumber,
  decodeSerial,
  Determinacy,
  EvidenceKind,
  EvidenceSource,
  EvidenceSubject,
  gradeWear,
  HardwareVerdict,
  hardwareSpecFor,
  IdentityVerdict,
  inspect,
  PartAuthenticity,
  ProvenanceEngine,
  runBatteryEngine,
  runHardwareEngine,
  runIdentityEngine,
  runSecurityEngine,
  runServiceEngine,
  SecurityVerdict,
  SerialFormat,
  ServiceVerdict,
  UnitProvenanceClass,
  WearGrade,
  type RawDeviceSnapshot,
} from '../src/index.js';

const at = '2026-03-14T10:24:00.000Z';

const run = <T>(
  snapshot: RawDeviceSnapshot,
  engine: (l: ReturnType<typeof collectEvidence>, p: ProvenanceEngine, at: string) => T,
): T => {
  const ledger = collectEvidence(snapshot);
  return engine(ledger, new ProvenanceEngine(ledger), at);
};

// --- Module 1 ---------------------------------------------------------------

describe('identifier decoding', () => {
  it('validates IMEI check digits against the published GSMA test value', () => {
    expect(decodeImei('490154203237518').checksumValid).toBe(true);
    expect(decodeImei('490154203237518').tac).toBe('49015420');
    // Same digits, wrong check digit.
    expect(decodeImei('490154203237511').checksumValid).toBe(false);
    expect(decodeImei('12345').wellFormed).toBe(false);
    expect(decodeImei(null).wellFormed).toBe(false);
  });

  it('decodes the model number prefix into how the unit reached the market', () => {
    expect(decodeModelNumber('MQ0G3LL/A').provenanceClass).toBe(UnitProvenanceClass.RETAIL);
    expect(decodeModelNumber('FQ0G3').provenanceClass).toBe(UnitProvenanceClass.APPLE_REFURBISHED);
    expect(decodeModelNumber('NQ0G3').provenanceClass).toBe(UnitProvenanceClass.SERVICE_REPLACEMENT);
    expect(decodeModelNumber('3Q0G3').provenanceClass).toBe(UnitProvenanceClass.DEMO);
    expect(decodeModelNumber('MQ0G3LL/A').regionSuffix).toBe('LL/A');
    expect(decodeModelNumber('').provenanceClass).toBe(UnitProvenanceClass.UNKNOWN);
  });

  it('distinguishes serial formats and only dates the ones that encode a date', () => {
    expect(decodeSerial('K7XVL2Q9PN').format).toBe(SerialFormat.RANDOMISED_10);
    // Randomised serials carry no date, so none is invented.
    expect(decodeSerial('K7XVL2Q9PN').manufactureYear).toBeNull();
    expect(decodeSerial('DNPT55ABCDEF').format).toBe(SerialFormat.LEGACY_12);
    expect(decodeSerial('DNPT55ABCDEF').manufactureYear).toBe(2017);
    expect(decodeSerial('nonsense!').format).toBe(SerialFormat.UNKNOWN);
  });
});

describe('identity engine', () => {
  it('finds consistent identifiers consistent', () => {
    const { result, detail } = run(buildSimulatedSnapshot('pristine-15-pro'), runIdentityEngine);
    expect(result.verdicts[0]?.value).toBe(IdentityVerdict.IDENTITY_CONSISTENT);
    expect(detail.checksPerformed.length).toBeGreaterThanOrEqual(4);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('catches a contradictory identity outright', () => {
    const { result, findings } = run(buildSimulatedSnapshot('tampered-identity-13'), runIdentityEngine);
    expect(result.verdicts[0]?.value).toBe(IdentityVerdict.IDENTITY_MISMATCH);
    expect(findings.map((f) => f.code)).toContain('IDENTITY_IMEI_INVALID');
  });

  it('lets one contradiction outweigh several agreeing checks', () => {
    // Identity is not a weighted opinion: an identifier that contradicts the
    // others is a mismatch however much else agrees.
    const base = buildSimulatedSnapshot('pristine-15-pro');
    const tampered: RawDeviceSnapshot = {
      ...base,
      lockdown: { ...base.lockdown, InternationalMobileEquipmentIdentity: '353281112345671' },
    };
    const { result } = run(tampered, runIdentityEngine);
    expect(result.verdicts[0]?.value).toBe(IdentityVerdict.IDENTITY_MISMATCH);
  });

  it('reports a service-replacement unit without calling it an identity fault', () => {
    const base = buildSimulatedSnapshot('pristine-15-pro');
    const replacement: RawDeviceSnapshot = {
      ...base,
      lockdown: { ...base.lockdown, ModelNumber: 'NTUW3' },
    };
    const { result, findings, detail } = run(replacement, runIdentityEngine);

    expect(detail.unitProvenance).toBe(UnitProvenanceClass.SERVICE_REPLACEMENT);
    expect(findings.map((f) => f.code)).toContain('IDENTITY_UNIT_SERVICE_REPLACEMENT');
    // Genuine Apple hardware with a valid identity, just not retail stock.
    expect(result.verdicts[0]?.value).toBe(IdentityVerdict.IDENTITY_CONSISTENT);
  });

  it('abstains when no identifier is readable', () => {
    const empty: RawDeviceSnapshot = {
      ...buildSimulatedSnapshot('pristine-15-pro'),
      lockdown: {},
      domains: {},
      ioregistry: {},
    };
    const { result } = run(empty, runIdentityEngine);
    expect(result.verdicts[0]?.value).toBe(IdentityVerdict.CANNOT_DETERMINE);
    expect(result.verdicts[0]?.determinacy).toBe(Determinacy.INDETERMINATE);
    expect(result.confidence).toBe(0);
  });
});

// --- Module 2 ---------------------------------------------------------------

describe('hardware consistency engine', () => {
  it('matches a device against its catalogued specification', () => {
    const { result, detail } = run(buildSimulatedSnapshot('pristine-15-pro'), runHardwareEngine);
    expect(result.verdicts[0]?.value).toBe(HardwareVerdict.SPECIFICATION_MATCH);
    expect(detail.anomalies).toEqual([]);
    expect(detail.expectedChip).toBe('A17 Pro');
  });

  it('detects a foreign logic board and an impossible storage tier', () => {
    const { result, detail, findings } = run(
      buildSimulatedSnapshot('tampered-identity-13'),
      runHardwareEngine,
    );
    expect(result.verdicts[0]?.value).toBe(HardwareVerdict.SPECIFICATION_ANOMALY);
    expect(detail.anomalies.map((a) => a.check)).toContain('board-id');
    expect(detail.anomalies.map((a) => a.check)).toContain('capacity-tier');
    expect(findings.map((f) => f.code)).toContain('HARDWARE_BOARD_ID_MISMATCH');
  });

  it('abstains rather than inventing a baseline for an uncatalogued model', () => {
    const base = buildSimulatedSnapshot('pristine-15-pro');
    const future: RawDeviceSnapshot = {
      ...base,
      lockdown: { ...base.lockdown, ProductType: 'iPhone99,1' },
    };
    const { result, detail, findings } = run(future, runHardwareEngine);

    expect(result.verdicts[0]?.value).toBe(HardwareVerdict.CANNOT_DETERMINE);
    expect(detail.modelCatalogued).toBe(false);
    expect(detail.anomalies).toEqual([]);
    expect(findings.map((f) => f.code)).toContain('HARDWARE_MODEL_NOT_CATALOGUED');
  });

  it('writes the expectation it judged against into the ledger', () => {
    const ledger = collectEvidence(buildSimulatedSnapshot('pristine-15-pro'));
    runHardwareEngine(ledger, new ProvenanceEngine(ledger), at);

    const catalogFacts = ledger.find((r) => r.provenance.source === EvidenceSource.DEVDNA_CATALOG);
    expect(catalogFacts.length).toBeGreaterThan(0);
    expect(catalogFacts.map((r) => r.key)).toContain('ExpectedBoardIds');
    expect(catalogFacts[0]?.provenance.method).toBe(CollectionMethod.CATALOG_LOOKUP);
  });

  it('keeps design capacity tolerance wide enough for genuine supplier variation', () => {
    const spec = hardwareSpecFor('iPhone16,1');
    expect(spec?.designCapacityMah).toBe(3274);
    // A cell 2% off spec is a genuine cell, not an anomaly.
    const base = buildSimulatedSnapshot('pristine-15-pro');
    const varied: RawDeviceSnapshot = {
      ...base,
      ioregistry: {
        AppleSmartBattery: { ...base.ioregistry['AppleSmartBattery'], DesignCapacity: 3210 },
      },
    };
    const { detail } = run(varied, runHardwareEngine);
    expect(detail.anomalies.map((a) => a.check)).not.toContain('battery-design-capacity');
  });
});

// --- Module 3 ---------------------------------------------------------------

describe('service evidence engine', () => {
  it('treats presence on Apple\'s service history as replacement evidence, whatever the label', () => {
    // The load-bearing correction: iOS only populates that screen when a
    // service record exists, so "Genuine Apple Part" means a genuine part was
    // *fitted during service*, not that the component is original.
    const { detail } = run(buildSimulatedSnapshot('serviced-14-pro'), runServiceEngine);
    const display = detail.components.find((c) => c.subject === EvidenceSubject.DISPLAY);

    expect(display?.verdict).toBe(ServiceVerdict.REPLACED_LIKELY);
    expect(display?.authenticity).toBe(PartAuthenticity.GENUINE_APPLE);
  });

  it('separates replacement from authenticity for a transplanted part', () => {
    const { detail } = run(buildSimulatedSnapshot('serviced-14-pro'), runServiceEngine);
    const battery = detail.components.find((c) => c.subject === EvidenceSubject.BATTERY);
    expect(battery?.verdict).toBe(ServiceVerdict.REPLACED_LIKELY);
    expect(battery?.authenticity).toBe(PartAuthenticity.GENUINE_TRANSPLANTED);
  });

  it('flags a part Apple could not verify', () => {
    const { detail, findings } = run(
      buildSimulatedSnapshot('counterfeit-display-13'),
      runServiceEngine,
    );
    const display = detail.components.find((c) => c.subject === EvidenceSubject.DISPLAY);
    expect(display?.verdict).toBe(ServiceVerdict.REPLACED_LIKELY);
    expect(display?.authenticity).toBe(PartAuthenticity.NOT_VERIFIED);
    expect(findings.map((f) => f.code)).toContain('SERVICE_PART_NOT_VERIFIED_DISPLAY');
  });

  it('uses an absent service-history section as originality evidence', () => {
    const { detail } = run(buildSimulatedSnapshot('pristine-15-pro'), runServiceEngine);
    const display = detail.components.find((c) => c.subject === EvidenceSubject.DISPLAY);
    expect(detail.serviceHistorySectionAbsent).toBe(true);
    expect(display?.verdict).toBe(ServiceVerdict.ORIGINAL_LIKELY);
  });

  it('treats absence from a populated history as evidence for that component', () => {
    // The section exists and lists other parts, so iOS is tracking and holds no
    // record for this one. Stronger than a blank screen.
    const { detail } = run(buildSimulatedSnapshot('serviced-14-pro'), runServiceEngine);
    const faceId = detail.components.find((c) => c.subject === EvidenceSubject.FACE_ID);
    expect(faceId?.verdict).toBe(ServiceVerdict.ORIGINAL_LIKELY);
  });

  it('never concludes ORIGINAL_LIKELY from an absence of evidence', () => {
    // No attestation, no analytics, no capability data: nothing at all.
    const { detail } = run(buildSimulatedSnapshot('activation-locked-12'), runServiceEngine);
    expect(detail.components.every((c) => c.verdict === ServiceVerdict.CANNOT_DETERMINE)).toBe(true);
    expect(detail.originalCount).toBe(0);
    expect(detail.indeterminateCount).toBeGreaterThan(0);
  });

  it('only ever emits the three permitted verdict values', () => {
    const permitted = new Set(Object.values(ServiceVerdict));
    for (const id of ['pristine-15-pro', 'serviced-14-pro', 'counterfeit-display-13'] as const) {
      const { detail } = run(buildSimulatedSnapshot(id), runServiceEngine);
      for (const component of detail.components) {
        expect(permitted.has(component.verdict)).toBe(true);
      }
    }
  });

  it('scopes components to the model, so an SE is not judged on Face ID', () => {
    const base = buildSimulatedSnapshot('pristine-15-pro');
    const se: RawDeviceSnapshot = {
      ...base,
      lockdown: { ...base.lockdown, ProductType: 'iPhone14,6', HardwareModel: 'D49AP' },
    };
    const { detail } = run(se, runServiceEngine);
    const subjects = detail.components.map((c) => c.subject);
    expect(subjects).toContain(EvidenceSubject.TOUCH_ID);
    expect(subjects).not.toContain(EvidenceSubject.FACE_ID);
    expect(subjects).not.toContain(EvidenceSubject.LIDAR);
  });
});

// --- Module 4 ---------------------------------------------------------------

describe('battery intelligence engine', () => {
  it('grades wear and projects replacement from the observed wear rate', () => {
    const { detail } = run(buildSimulatedSnapshot('pristine-15-pro'), runBatteryEngine);
    expect(detail.maximumCapacityPercent).toBe(99);
    expect(detail.cycleCount).toBe(42);
    expect(detail.wearGrade).toBe(WearGrade.A);
    expect(detail.replacementLikelihood).toBeLessThan(0.1);
    expect(detail.wearRatePer100Cycles).toBeGreaterThan(0);
    expect(detail.assumptions.length).toBeGreaterThan(0);
  });

  it('treats an already-degraded cell as replacement due now, not projected', () => {
    const { detail } = run(buildSimulatedSnapshot('counterfeit-display-13'), runBatteryEngine);
    expect(detail.maximumCapacityPercent).toBe(76);
    expect(detail.replacementLikelihood).toBe(1);
    expect(detail.assumptions.join(' ')).toMatch(/already below/i);
  });

  it('preserves every raw measurement it used', () => {
    const ledger = collectEvidence(buildSimulatedSnapshot('serviced-14-pro'));
    const { detail } = runBatteryEngine(ledger, new ProvenanceEngine(ledger), at);
    expect(detail.rawEvidenceIds.length).toBeGreaterThan(2);
    for (const id of detail.rawEvidenceIds) expect(ledger.has(id)).toBe(true);
  });

  it('abstains and reports zero confidence when no health source answers', () => {
    const { result, detail, findings } = run(
      buildSimulatedSnapshot('legacy-sparse-8'),
      runBatteryEngine,
    );
    expect(result.verdicts[0]?.value).toBe('CANNOT_DETERMINE');
    expect(detail.maximumCapacityPercent).toBeNull();
    expect(detail.wearGrade).toBe(WearGrade.UNGRADED);
    expect(detail.replacementLikelihood).toBeNull();
    expect(result.confidence).toBe(0);
    expect(findings.map((f) => f.code)).toContain('BATTERY_HEALTH_UNAVAILABLE');
  });

  it('refuses to project from a cycle count too low to be meaningful', () => {
    const base = buildSimulatedSnapshot('pristine-15-pro');
    const nearlyNew: RawDeviceSnapshot = {
      ...base,
      ioregistry: {
        AppleSmartBattery: { ...base.ioregistry['AppleSmartBattery'], CycleCount: 3 },
      },
      analytics: null,
    };
    const { detail } = run(nearlyNew, runBatteryEngine);
    expect(detail.replacementLikelihood).toBeNull();
    expect(detail.assumptions.join(' ')).toMatch(/too low/i);
  });

  it('demotes a grade when the cell is past its rated cycle life', () => {
    expect(gradeWear(96, 100, 1000)).toBe(WearGrade.A);
    // Same capacity, but well past the rating: remaining capacity is a lagging
    // indicator of a worn cell.
    expect(gradeWear(96, 1200, 1000)).toBe(WearGrade.B);
    expect(gradeWear(65, 200, 1000)).toBe(WearGrade.E);
  });
});

// --- Module 5 ---------------------------------------------------------------

describe('securityDNA engine', () => {
  it('reports a clean posture for an unmodified device', () => {
    const { result, detail } = run(buildSimulatedSnapshot('pristine-15-pro'), runSecurityEngine);
    expect(result.verdicts[0]?.value).toBe(SecurityVerdict.POSTURE_CLEAN);
    expect(detail.postureScore).toBe(100);
    expect(detail.integrityCompromised).toBe(false);
  });

  it('detects integrity compromise from apps and services', () => {
    const base = buildSimulatedSnapshot('pristine-15-pro');
    const jailbroken: RawDeviceSnapshot = {
      ...base,
      installedApps: ['com.saurik.Cydia'],
      services: [...base.services, 'com.apple.afc2'],
    };
    const { result, detail, findings } = run(jailbroken, runSecurityEngine);

    expect(result.verdicts[0]?.value).toBe(SecurityVerdict.POSTURE_COMPROMISED);
    expect(detail.integrityCompromised).toBe(true);
    expect(detail.jailbreakIndicators).toHaveLength(2);
    expect(findings.map((f) => f.code)).toContain('SECURITY_INTEGRITY_COMPROMISED');
  });

  it('reports activation lock and supervision', () => {
    const { detail, findings } = run(buildSimulatedSnapshot('activation-locked-12'), runSecurityEngine);
    expect(detail.activationLockEnabled).toBe(true);
    expect(detail.supervised).toBe(true);
    expect(findings.map((f) => f.code)).toContain('SECURITY_ACTIVATION_LOCK_ON');
    expect(detail.postureScore).toBeLessThan(50);
  });

  it('says so loudly when activation lock cannot be determined', () => {
    const { detail, findings } = run(buildSimulatedSnapshot('legacy-sparse-8'), runSecurityEngine);
    expect(detail.activationLockEnabled).toBeNull();
    expect(findings.map((f) => f.code)).toContain('SECURITY_ACTIVATION_LOCK_UNKNOWN');
  });

  it('records every posture deduction with its reason', () => {
    const { detail } = run(buildSimulatedSnapshot('activation-locked-12'), runSecurityEngine);
    expect(detail.deductions.length).toBeGreaterThan(0);
    for (const deduction of detail.deductions) {
      expect(deduction.reason).toBeTruthy();
      expect(deduction.points).toBeGreaterThan(0);
    }
  });
});

describe('module outputs are internally consistent', () => {
  it('never reports coverage or confidence outside 0..1', () => {
    for (const id of ['pristine-15-pro', 'counterfeit-display-13', 'legacy-sparse-8'] as const) {
      const report = inspect(buildSimulatedSnapshot(id));
      for (const module of Object.values(report.modules)) {
        expect(module.coverage).toBeGreaterThanOrEqual(0);
        expect(module.coverage).toBeLessThanOrEqual(1);
        expect(module.confidence).toBeGreaterThanOrEqual(0);
        expect(module.confidence).toBeLessThanOrEqual(1);
      }
    }
  });

  it('gives every verdict a rationale a technician could repeat', () => {
    for (const id of ['pristine-15-pro', 'counterfeit-display-13'] as const) {
      const report = inspect(buildSimulatedSnapshot(id));
      for (const module of Object.values(report.modules)) {
        for (const verdict of module.verdicts) {
          expect(verdict.rationale.length).toBeGreaterThan(10);
        }
      }
    }
  });
});
