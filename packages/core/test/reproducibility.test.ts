import { describe, expect, it } from 'vitest';
import {
  buildSimulatedSnapshot,
  collectEvidence,
  ConfidenceBand,
  corroborate,
  dampByCoverage,
  evaluate,
  evaluateStoredEvidence,
  EvidenceLedger,
  EvidenceSource,
  inspect,
  MINIMUM_REPORTABLE_CONFIDENCE,
  ModuleId,
  SIMULATOR_PROFILES,
  TrustVerdict,
  verdictConfidence,
  type Inference,
} from '../src/index.js';

const AT = '2026-03-14T10:24:00.000Z';

describe('reproducibility: every score recomputable from stored evidence', () => {
  it('reproduces an identical report from the ledger alone, with no snapshot', () => {
    for (const profile of SIMULATOR_PROFILES) {
      const snapshot = profile.build();
      const fromSnapshot = inspect(snapshot, { at: AT });

      // Persist only the evidence, exactly as the database would.
      const stored = JSON.parse(JSON.stringify(fromSnapshot.evidence));
      const fromLedger = evaluateStoredEvidence(stored, { at: AT });

      expect(fromLedger.ledgerDigest, profile.id).toBe(fromSnapshot.ledgerDigest);
      expect(fromLedger.trust, profile.id).toEqual(fromSnapshot.trust);
      expect(fromLedger.modules, profile.id).toEqual(fromSnapshot.modules);
      expect(fromLedger.details, profile.id).toEqual(fromSnapshot.details);
      expect(fromLedger.findings, profile.id).toEqual(fromSnapshot.findings);
      expect(fromLedger.auditTrail, profile.id).toEqual(fromSnapshot.auditTrail);
    }
  });

  it('is deterministic: the same evidence always yields the same report', () => {
    const ledger = collectEvidence(buildSimulatedSnapshot('serviced-14-pro'));
    expect(evaluate(ledger, { at: AT })).toEqual(evaluate(ledger, { at: AT }));
  });

  it('gives stable ids across runs, so evidence can be referenced over time', () => {
    const first = inspect(buildSimulatedSnapshot('counterfeit-display-13'), { at: AT });
    const second = inspect(buildSimulatedSnapshot('counterfeit-display-13'), { at: AT });

    expect(second.evidence.map((e) => e.id)).toEqual(first.evidence.map((e) => e.id));
    expect(second.modules.service.inferences.map((i) => i.id)).toEqual(
      first.modules.service.inferences.map((i) => i.id),
    );
  });

  it('changes the digest when the evidence changes, so tampering is detectable', () => {
    const report = inspect(buildSimulatedSnapshot('pristine-15-pro'), { at: AT });
    const tampered = report.evidence.map((record) =>
      record.key === 'CycleCount' ? { ...record, value: 1 } : record,
    );
    expect(EvidenceLedger.from(tampered).digest()).not.toBe(report.ledgerDigest);
  });

  it('re-scores a stored ledger under the current engine without the original capture', () => {
    const original = inspect(buildSimulatedSnapshot('serviced-14-pro'), { at: AT });
    const rescored = evaluateStoredEvidence(original.evidence, { at: '2027-01-01T00:00:00.000Z' });

    // Same evidence, same conclusions; only the evaluation timestamp moves.
    expect(rescored.trust.score).toBe(original.trust.score);
    expect(rescored.ledgerDigest).toBe(original.ledgerDigest);
    expect(rescored.inspectedAt).not.toBe(original.inspectedAt);
  });

  it('keeps raw evidence separate from every conclusion', () => {
    const report = inspect(buildSimulatedSnapshot('counterfeit-display-13'), { at: AT });

    // Evidence carries no verdicts, scores or confidence-in-conclusions.
    for (const record of report.evidence) {
      expect(record).not.toHaveProperty('verdict');
      expect(record).not.toHaveProperty('score');
      expect(Object.keys(record).sort()).toEqual(
        expect.arrayContaining(['id', 'key', 'kind', 'provenance', 'subject', 'value']),
      );
    }

    // Conclusions carry no values of their own, only references back.
    for (const module of Object.values(report.modules)) {
      for (const verdict of module.verdicts) {
        expect(verdict).not.toHaveProperty('value_observed');
        expect(Array.isArray(verdict.evidenceIds)).toBe(true);
      }
    }
  });
});

describe('confidence model', () => {
  const inference = (confidence: number, sources: EvidenceSource[]): Inference => ({
    id: `in_${confidence}_${sources.join('')}`,
    module: ModuleId.SERVICE_EVIDENCE,
    rule: 'test',
    subject: 'DISPLAY' as never,
    direction: 'SUPPORTS_NEGATIVE' as never,
    statement: 'test',
    weight: 1,
    confidence,
    evidenceIds: sources.map((s) => `ev_${s}`),
    derivedAt: AT,
  });

  const ledgerWithSources = (sources: EvidenceSource[]): EvidenceLedger =>
    EvidenceLedger.from(
      sources.map((source) => ({
        id: `ev_${source}`,
        kind: 'DEVICE_PROPERTY' as never,
        subject: 'DISPLAY' as never,
        key: 'k',
        value: 1,
        provenance: {
          source,
          method: 'LOCKDOWN_GLOBAL_QUERY' as never,
          observedAt: AT,
          reliability: 1,
          collector: 'test',
        },
      })),
    );

  it('compounds corroboration across independent sources', () => {
    const ledger = ledgerWithSources([EvidenceSource.DEVICE_OS, EvidenceSource.TECHNICIAN]);
    const { confidence, independentSources } = corroborate(
      [inference(0.6, [EvidenceSource.DEVICE_OS]), inference(0.6, [EvidenceSource.TECHNICIAN])],
      ledger,
    );
    expect(independentSources).toBe(2);
    // Noisy-OR: 1 - 0.4*0.4
    expect(confidence).toBeCloseTo(0.84, 2);
  });

  it('refuses to compound a single source repeating itself', () => {
    const ledger = ledgerWithSources([EvidenceSource.DEVICE_ANALYTICS]);
    const { confidence, independentSources } = corroborate(
      [
        inference(0.6, [EvidenceSource.DEVICE_ANALYTICS]),
        inference(0.6, [EvidenceSource.DEVICE_ANALYTICS]),
        inference(0.5, [EvidenceSource.DEVICE_ANALYTICS]),
      ],
      ledger,
    );
    // Three readings of one analytics file are one observation, not three.
    expect(independentSources).toBe(1);
    expect(confidence).toBeCloseTo(0.6, 5);
  });

  it('lowers confidence when evidence conflicts, even where one side wins', () => {
    const ledger = ledgerWithSources([EvidenceSource.DEVICE_OS]);
    const uncontested = verdictConfidence({
      supporting: [inference(0.8, [EvidenceSource.DEVICE_OS])],
      opposingMass: 0,
      ledger,
    });
    const contested = verdictConfidence({
      supporting: [inference(0.8, [EvidenceSource.DEVICE_OS])],
      opposingMass: 0.5,
      ledger,
    });

    expect(contested.confidence).toBeLessThan(uncontested.confidence);
    expect(contested.agreement).toBeLessThan(1);
  });

  it('damps confidence by coverage without collapsing it to nothing', () => {
    expect(dampByCoverage(1, 1)).toBe(1);
    expect(dampByCoverage(1, 0)).toBe(0.35);
    expect(dampByCoverage(1, 0.5)).toBeLessThan(1);
    expect(dampByCoverage(1, 0.5)).toBeGreaterThan(dampByCoverage(1, 0.2));
  });

  it('returns zero for no evidence at all', () => {
    expect(corroborate([], ledgerWithSources([])).confidence).toBe(0);
  });
});

describe('trust aggregation', () => {
  const report = (id: Parameters<typeof buildSimulatedSnapshot>[0]) =>
    inspect(buildSimulatedSnapshot(id), { at: AT });

  it('excludes pillars a module could not assess rather than scoring them zero', () => {
    const sparse = report('legacy-sparse-8');
    const battery = sparse.trust.pillars.find((p) => p.module === ModuleId.BATTERY_INTELLIGENCE);

    expect(battery?.score).toBeNull();
    expect(battery?.effectiveWeight).toBe(0);
    // Excluded from the score, but it drags coverage down.
    expect(sparse.trust.coverage).toBeLessThan(0.4);
  });

  it('lets abstentions drag aggregate confidence down', () => {
    // The subtle failure mode this guards against: measuring confidence only
    // across pillars that answered makes a mostly-blind inspection look sure of
    // itself, and INSUFFICIENT_EVIDENCE then never fires when it matters most.
    const sparse = report('legacy-sparse-8');
    const complete = report('pristine-15-pro');

    expect(sparse.trust.confidence).toBeLessThan(MINIMUM_REPORTABLE_CONFIDENCE);
    expect(complete.trust.confidence).toBeGreaterThan(MINIMUM_REPORTABLE_CONFIDENCE);
    expect(sparse.trust.verdict).toBe(TrustVerdict.INSUFFICIENT_EVIDENCE);
    expect(sparse.trust.confidenceBand).toBe(ConfidenceBand.INSUFFICIENT);
  });

  it('reports INSUFFICIENT_EVIDENCE regardless of how high the score was', () => {
    const sparse = report('legacy-sparse-8');
    expect(sparse.trust.rawScore).toBeGreaterThan(TrustVerdict.TRUSTED.length); // sanity: a high raw score
    expect(sparse.trust.rawScore).toBeGreaterThanOrEqual(85);
    expect(sparse.trust.verdict).toBe(TrustVerdict.INSUFFICIENT_EVIDENCE);
  });

  it('caps rather than subtracts, so good condition cannot buy back a lock', () => {
    const locked = report('activation-locked-12');
    expect(locked.trust.rawScore).toBeGreaterThan(70);
    expect(locked.trust.score).toBeLessThanOrEqual(35);
    expect(locked.trust.gatesApplied.map((g) => g.code)).toContain('ACTIVATION_LOCK_ON');
    expect(locked.trust.verdict).toBe(TrustVerdict.UNTRUSTED);
  });

  it('caps on a contradictory identity', () => {
    const tampered = report('tampered-identity-13');
    expect(tampered.trust.gatesApplied.map((g) => g.code)).toContain('IDENTITY_MISMATCH');
    expect(tampered.trust.gatesApplied.map((g) => g.code)).toContain('HARDWARE_ANOMALY');
    expect(tampered.trust.score).toBeLessThanOrEqual(30);
  });

  it('withholds a flawless score unless coverage is near total', () => {
    const pristine = report('pristine-15-pro');
    expect(pristine.trust.rawScore).toBe(100);
    expect(pristine.trust.score).toBeLessThan(100);
    expect(pristine.trust.gatesApplied.map((g) => g.code)).toContain('COVERAGE_NOT_TOTAL');
  });

  it('always discloses established replacement in the verdict, not just the score', () => {
    // A device serviced with genuine Apple parts is sound and scores well, but
    // must never present as untouched.
    const serviced = report('serviced-14-pro');
    expect(serviced.details.service.replacedCount).toBeGreaterThan(0);
    expect(serviced.trust.score).toBeGreaterThanOrEqual(85);
    expect(serviced.trust.verdict).toBe(TrustVerdict.TRUSTED_WITH_NOTES);
  });

  it('normalises effective pillar weights to one', () => {
    for (const profile of SIMULATOR_PROFILES) {
      const trust = inspect(profile.build(), { at: AT }).trust;
      const total = trust.pillars.reduce((sum, p) => sum + p.effectiveWeight, 0);
      if (trust.pillars.some((p) => p.score !== null)) {
        expect(total, profile.id).toBeCloseTo(1, 2);
      }
    }
  });

  it('classifies every fixture the way a trade buyer would expect', () => {
    expect(report('pristine-15-pro').trust.verdict).toBe(TrustVerdict.TRUSTED);
    expect(report('serviced-14-pro').trust.verdict).toBe(TrustVerdict.TRUSTED_WITH_NOTES);
    expect(report('counterfeit-display-13').trust.verdict).toBe(TrustVerdict.UNTRUSTED);
    expect(report('activation-locked-12').trust.verdict).toBe(TrustVerdict.UNTRUSTED);
    expect(report('tampered-identity-13').trust.verdict).toBe(TrustVerdict.UNTRUSTED);
    expect(report('legacy-sparse-8').trust.verdict).toBe(TrustVerdict.INSUFFICIENT_EVIDENCE);
  });

  it('emits no duplicate finding codes', () => {
    for (const profile of SIMULATOR_PROFILES) {
      const codes = inspect(profile.build(), { at: AT }).findings.map((f) => f.code);
      expect(new Set(codes).size, profile.id).toBe(codes.length);
    }
  });
});
