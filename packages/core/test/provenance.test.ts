import { describe, expect, it } from 'vitest';
import {
  buildSimulatedSnapshot,
  collectEvidence,
  CollectionMethod,
  Determinacy,
  EvidenceKind,
  EvidenceLedger,
  EvidenceSource,
  EvidenceSubject,
  FindingBasis,
  InferenceDirection,
  inspect,
  ModuleId,
  ProvenanceEngine,
  ProvenanceViolation,
  Severity,
  SIMULATOR_PROFILES,
  ViolationCode,
} from '../src/index.js';

const at = '2026-03-14T10:24:00.000Z';

function ledgerWithOneFact(): { ledger: EvidenceLedger; evidenceId: string } {
  const ledger = new EvidenceLedger();
  const record = ledger.record({
    kind: EvidenceKind.DEVICE_PROPERTY,
    subject: EvidenceSubject.DEVICE,
    key: 'ProductType',
    value: 'iPhone16,1',
    source: EvidenceSource.DEVICE_OS,
    method: CollectionMethod.LOCKDOWN_GLOBAL_QUERY,
    collector: 'lockdown.global',
    observedAt: at,
  });
  return { ledger, evidenceId: record.id };
}

const inference = (evidenceIds: string[]) => ({
  module: ModuleId.IDENTITY,
  rule: 'test.rule',
  subject: EvidenceSubject.DEVICE,
  direction: InferenceDirection.SUPPORTS_POSITIVE,
  statement: 'test statement',
  weight: 0.5,
  ruleConfidence: 0.9,
  evidenceIds,
  at,
});

describe('provenance engine: construction-time enforcement', () => {
  it('refuses an inference that cites no evidence', () => {
    const { ledger } = ledgerWithOneFact();
    const engine = new ProvenanceEngine(ledger);

    expect(() => engine.derive(inference([]))).toThrow(ProvenanceViolation);
    try {
      engine.derive(inference([]));
    } catch (error) {
      expect((error as ProvenanceViolation).code).toBe(ViolationCode.INFERENCE_WITHOUT_EVIDENCE);
    }
  });

  it('refuses an inference citing evidence absent from the ledger', () => {
    const { ledger } = ledgerWithOneFact();
    const engine = new ProvenanceEngine(ledger);
    expect(() => engine.derive(inference(['ev_doesnotexist']))).toThrow(
      /not in the ledger/,
    );
  });

  it('damps inference confidence to the weakest cited channel', () => {
    const ledger = new EvidenceLedger();
    const strong = ledger.record({
      kind: EvidenceKind.DEVICE_PROPERTY,
      subject: EvidenceSubject.DEVICE,
      key: 'ProductType',
      value: 'iPhone16,1',
      source: EvidenceSource.DEVICE_OS,
      method: CollectionMethod.LOCKDOWN_GLOBAL_QUERY, // 0.97
      collector: 'lockdown.global',
      observedAt: at,
    });
    const weak = ledger.record({
      kind: EvidenceKind.SERVICE_RECORD_STATEMENT,
      subject: EvidenceSubject.DISPLAY,
      key: 'ServiceHistoryLabel',
      value: 'Genuine Apple Part',
      source: EvidenceSource.TECHNICIAN,
      method: CollectionMethod.OCR_EXTRACTION, // 0.60
      collector: 'attestation',
      observedAt: at,
    });

    const engine = new ProvenanceEngine(ledger);
    const strongOnly = engine.derive(inference([strong.id]));
    const mixed = engine.derive({ ...inference([strong.id, weak.id]), rule: 'test.mixed' });

    expect(strongOnly.confidence).toBeCloseTo(0.9 * 0.97, 5);
    // A chain is no stronger than its shakiest link, even alongside a solid one.
    expect(mixed.confidence).toBeCloseTo(0.9 * 0.6, 5);
    expect(mixed.confidence).toBeLessThan(strongOnly.confidence);
  });

  it('refuses a DETERMINED verdict with no supporting inference', () => {
    const { ledger } = ledgerWithOneFact();
    const engine = new ProvenanceEngine(ledger);

    expect(() =>
      engine.conclude({
        module: ModuleId.IDENTITY,
        subject: EvidenceSubject.DEVICE,
        value: 'IDENTITY_CONSISTENT',
        determinacy: Determinacy.DETERMINED,
        confidence: 0.9,
        rationale: 'because I said so',
        inferenceIds: [],
      }),
    ).toThrow(/no supporting inference/);
  });

  it('always allows an INDETERMINATE verdict, and forces its confidence to zero', () => {
    const { ledger } = ledgerWithOneFact();
    const engine = new ProvenanceEngine(ledger);

    const verdict = engine.conclude({
      module: ModuleId.SERVICE_EVIDENCE,
      subject: EvidenceSubject.DISPLAY,
      value: 'CANNOT_DETERMINE',
      determinacy: Determinacy.INDETERMINATE,
      // Even if a module tries to claim confidence in an abstention...
      confidence: 0.9,
      rationale: 'nothing was obtainable',
      inferenceIds: [],
    });

    // ...there is nothing for that confidence to be *in*.
    expect(verdict.confidence).toBe(0);
  });

  it('derives a verdict evidence set from its inferences, not from the caller', () => {
    const { ledger, evidenceId } = ledgerWithOneFact();
    const engine = new ProvenanceEngine(ledger);
    const derived = engine.derive(inference([evidenceId]));

    const verdict = engine.conclude({
      module: ModuleId.IDENTITY,
      subject: EvidenceSubject.DEVICE,
      value: 'IDENTITY_CONSISTENT',
      determinacy: Determinacy.DETERMINED,
      confidence: 0.8,
      rationale: 'checks passed',
      inferenceIds: [derived.id],
    });

    expect(verdict.evidenceIds).toEqual([evidenceId]);
  });
});

describe('provenance engine: post-hoc audit', () => {
  it('catches a hand-built verdict that cites a non-existent inference', () => {
    const { ledger } = ledgerWithOneFact();
    const violations = ProvenanceEngine.audit(ledger, [
      {
        module: ModuleId.IDENTITY,
        verdicts: [
          {
            id: 'vd_fake',
            module: ModuleId.IDENTITY,
            subject: EvidenceSubject.DEVICE,
            value: 'IDENTITY_CONSISTENT',
            determinacy: Determinacy.DETERMINED,
            confidence: 0.9,
            rationale: 'fabricated',
            inferenceIds: ['in_nonexistent'],
            evidenceIds: [],
          },
        ],
        inferences: [],
        coverage: 1,
        confidence: 1,
      },
    ]);

    expect(violations.map((v) => v.code)).toContain(ViolationCode.VERDICT_CITES_MISSING_INFERENCE);
  });

  it('catches a verdict whose evidence set does not match its inferences', () => {
    const { ledger, evidenceId } = ledgerWithOneFact();
    const engine = new ProvenanceEngine(ledger);
    const derived = engine.derive(inference([evidenceId]));

    const violations = ProvenanceEngine.audit(ledger, [
      {
        module: ModuleId.IDENTITY,
        verdicts: [
          {
            id: 'vd_tampered',
            module: ModuleId.IDENTITY,
            subject: EvidenceSubject.DEVICE,
            value: 'IDENTITY_CONSISTENT',
            determinacy: Determinacy.DETERMINED,
            confidence: 0.9,
            rationale: 'looks well supported',
            inferenceIds: [derived.id],
            // Padded with evidence the reasoning never used.
            evidenceIds: [evidenceId, 'ev_padding'],
          },
        ],
        inferences: [derived],
        coverage: 1,
        confidence: 1,
      },
    ]);

    expect(violations.map((v) => v.code)).toContain(ViolationCode.VERDICT_EVIDENCE_MISMATCH);
  });

  it('catches a finding that claims evidence support but cites none', () => {
    const { ledger } = ledgerWithOneFact();
    const violations = ProvenanceEngine.audit(
      ledger,
      [],
      [
        {
          code: 'MADE_UP',
          severity: Severity.HIGH,
          module: ModuleId.IDENTITY,
          title: 'Something alarming',
          detail: 'with nothing behind it',
          basis: FindingBasis.EVIDENCE,
          evidenceIds: [],
          inferenceIds: [],
        },
      ],
    );
    expect(violations.map((v) => v.code)).toContain(ViolationCode.FINDING_WITHOUT_SUPPORT);
  });

  it('catches a supported finding masquerading as a claim about absence', () => {
    const { ledger, evidenceId } = ledgerWithOneFact();
    const violations = ProvenanceEngine.audit(
      ledger,
      [],
      [
        {
          code: 'MISLABELLED',
          severity: Severity.LOW,
          module: ModuleId.IDENTITY,
          title: 'Claims absence',
          detail: 'but cites a record',
          basis: FindingBasis.ABSENCE,
          evidenceIds: [evidenceId],
          inferenceIds: [],
        },
      ],
    );
    expect(violations.map((v) => v.code)).toContain(ViolationCode.FINDING_BASIS_MISMATCH);
  });

  it('accepts a genuine absence finding that cites nothing', () => {
    const { ledger } = ledgerWithOneFact();
    const violations = ProvenanceEngine.audit(
      ledger,
      [],
      [
        {
          code: 'SERVICE_NO_ATTESTATION',
          severity: Severity.LOW,
          module: ModuleId.SERVICE_EVIDENCE,
          title: 'No attestation captured',
          detail: 'nothing to cite, by construction',
          basis: FindingBasis.ABSENCE,
          evidenceIds: [],
          inferenceIds: [],
        },
      ],
    );
    expect(violations).toHaveLength(0);
  });
});

describe('no unsupported conclusions, across every fixture', () => {
  it('produces zero provenance violations for every simulator profile', () => {
    for (const profile of SIMULATOR_PROFILES) {
      const report = inspect(profile.build());
      expect(report.provenanceViolations, `${profile.id}: ${JSON.stringify(report.provenanceViolations)}`).toEqual([]);
    }
  });

  it('gives every determined verdict at least one inference and one evidence record', () => {
    for (const profile of SIMULATOR_PROFILES) {
      const report = inspect(profile.build());
      for (const module of Object.values(report.modules)) {
        for (const verdict of module.verdicts) {
          if (verdict.determinacy !== Determinacy.DETERMINED) continue;
          expect(verdict.inferenceIds.length, `${profile.id} ${verdict.value}`).toBeGreaterThan(0);
          expect(verdict.evidenceIds.length, `${profile.id} ${verdict.value}`).toBeGreaterThan(0);
          for (const id of verdict.evidenceIds) {
            expect(report.evidence.some((e) => e.id === id)).toBe(true);
          }
        }
      }
    }
  });

  it('gives every inference a citable, existing evidence record', () => {
    for (const profile of SIMULATOR_PROFILES) {
      const report = inspect(profile.build());
      const ids = new Set(report.evidence.map((e) => e.id));
      for (const module of Object.values(report.modules)) {
        for (const inf of module.inferences) {
          expect(inf.evidenceIds.length).toBeGreaterThan(0);
          for (const id of inf.evidenceIds) expect(ids.has(id)).toBe(true);
        }
      }
    }
  });

  it('records an ordered audit trail for every inspection', () => {
    const report = inspect(buildSimulatedSnapshot('counterfeit-display-13'));
    expect(report.auditTrail.length).toBeGreaterThan(10);

    const sequences = report.auditTrail.map((e) => e.sequence);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    expect(report.auditTrail.map((e) => e.action)).toContain('VERDICT_CONCLUDED');
    expect(report.auditTrail.map((e) => e.action)).toContain('SCORE_COMPUTED');
    expect(report.auditTrail.map((e) => e.action)).toContain('GATE_APPLIED');
  });
});
