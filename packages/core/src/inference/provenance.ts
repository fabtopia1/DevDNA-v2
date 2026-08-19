import { createHash } from 'node:crypto';
import type { EvidenceLedger } from '../evidence/ledger.js';
import { EvidenceKind, type EvidenceSubject } from '../evidence/types.js';
import {
  Determinacy,
  FindingBasis,
  InferenceDirection,
  type Finding,
  type Inference,
  type ModuleId,
  type ModuleResult,
  type Verdict,
} from './types.js';

/**
 * Module 6 - the Provenance Engine.
 *
 * This is not a data shape, it is an enforcement mechanism. Every inference and
 * every verdict in the system is constructed through it, and it refuses to
 * build one that cannot point at its support:
 *
 *   - an inference must cite at least one evidence record, and every cited id
 *     must actually exist in the ledger;
 *   - a DETERMINED verdict must cite at least one inference;
 *   - an INDETERMINATE verdict must cite the evidence explaining why it could
 *     not conclude, or explicitly declare that nothing was observed.
 *
 * "No unsupported conclusions allowed" is therefore a runtime invariant that
 * the test suite asserts across every fixture, rather than a rule people are
 * asked to remember.
 */

export class ProvenanceViolation extends Error {
  constructor(
    readonly code: ViolationCode,
    message: string,
    readonly context: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ProvenanceViolation';
  }
}

export enum ViolationCode {
  INFERENCE_WITHOUT_EVIDENCE = 'INFERENCE_WITHOUT_EVIDENCE',
  INFERENCE_CITES_MISSING_EVIDENCE = 'INFERENCE_CITES_MISSING_EVIDENCE',
  VERDICT_WITHOUT_INFERENCE = 'VERDICT_WITHOUT_INFERENCE',
  VERDICT_CITES_MISSING_INFERENCE = 'VERDICT_CITES_MISSING_INFERENCE',
  VERDICT_EVIDENCE_MISMATCH = 'VERDICT_EVIDENCE_MISMATCH',
  DETERMINED_WITHOUT_CONFIDENCE = 'DETERMINED_WITHOUT_CONFIDENCE',
  FINDING_WITHOUT_SUPPORT = 'FINDING_WITHOUT_SUPPORT',
  FINDING_BASIS_MISMATCH = 'FINDING_BASIS_MISMATCH',
  CONFIDENCE_OUT_OF_RANGE = 'CONFIDENCE_OUT_OF_RANGE',
}

export interface Violation {
  code: ViolationCode;
  message: string;
  context: Record<string, unknown>;
}

/** One step in the reproducible audit trail. */
export interface AuditEntry {
  sequence: number;
  at: string;
  module: ModuleId | 'PIPELINE';
  action:
    | 'EVIDENCE_COLLECTED'
    | 'INFERENCE_DERIVED'
    | 'VERDICT_CONCLUDED'
    | 'MODULE_COMPLETED'
    | 'SCORE_COMPUTED'
    | 'GATE_APPLIED';
  summary: string;
  refs: { evidenceIds?: string[]; inferenceIds?: string[]; verdictIds?: string[] };
}

export interface DeriveInferenceInput {
  module: ModuleId;
  rule: string;
  subject: EvidenceSubject;
  direction: InferenceDirection;
  statement: string;
  weight: number;
  /** Rule strength before evidence reliability is applied. */
  ruleConfidence: number;
  evidenceIds: string[];
  at: string;
}

export interface ConcludeVerdictInput<V extends string> {
  module: ModuleId;
  subject: EvidenceSubject;
  value: V;
  determinacy: Determinacy;
  confidence: number;
  rationale: string;
  inferenceIds: string[];
}

export class ProvenanceEngine {
  private readonly inferences = new Map<string, Inference>();
  private readonly verdicts = new Map<string, Verdict>();
  private readonly trail: AuditEntry[] = [];
  private sequence = 0;

  constructor(private readonly ledger: EvidenceLedger) {}

  /**
   * Build an inference.
   *
   * Confidence is the rule's own strength damped by the *weakest* cited
   * evidence channel: a chain of reasoning cannot be more reliable than the
   * shakiest observation it rests on.
   */
  derive(input: DeriveInferenceInput): Inference {
    if (input.evidenceIds.length === 0) {
      throw new ProvenanceViolation(
        ViolationCode.INFERENCE_WITHOUT_EVIDENCE,
        `Rule ${input.rule} tried to derive an inference citing no evidence`,
        { rule: input.rule, module: input.module },
      );
    }

    const reliabilities: number[] = [];
    for (const id of input.evidenceIds) {
      const record = this.ledger.get(id);
      if (!record) {
        throw new ProvenanceViolation(
          ViolationCode.INFERENCE_CITES_MISSING_EVIDENCE,
          `Rule ${input.rule} cited evidence ${id}, which is not in the ledger`,
          { rule: input.rule, evidenceId: id },
        );
      }
      reliabilities.push(record.provenance.reliability);
    }

    const weakestLink = Math.min(...reliabilities);
    const confidence = clamp01(input.ruleConfidence * weakestLink);

    const id = `in_${createHash('sha256')
      .update([input.module, input.rule, input.subject, ...[...input.evidenceIds].sort()].join(' '))
      .digest('hex')
      .slice(0, 24)}`;

    const inference: Inference = {
      id,
      module: input.module,
      rule: input.rule,
      subject: input.subject,
      direction: input.direction,
      statement: input.statement,
      weight: clamp01(input.weight),
      confidence,
      evidenceIds: [...input.evidenceIds].sort(),
      derivedAt: input.at,
    };

    this.inferences.set(id, inference);
    this.log({
      at: input.at,
      module: input.module,
      action: 'INFERENCE_DERIVED',
      summary: `${input.rule}: ${input.statement}`,
      refs: { evidenceIds: inference.evidenceIds, inferenceIds: [id] },
    });
    return inference;
  }

  /**
   * Build a verdict.
   *
   * A DETERMINED verdict without a supporting inference is rejected outright.
   * An INDETERMINATE verdict is always allowed, because refusing to conclude is
   * a legitimate outcome that must never be blocked by a validation rule.
   */
  conclude<V extends string>(input: ConcludeVerdictInput<V>): Verdict<V> {
    if (input.determinacy === Determinacy.DETERMINED && input.inferenceIds.length === 0) {
      throw new ProvenanceViolation(
        ViolationCode.VERDICT_WITHOUT_INFERENCE,
        `${input.module} concluded ${input.value} for ${input.subject} with no supporting inference`,
        { module: input.module, subject: input.subject, value: input.value },
      );
    }

    const evidenceIds = new Set<string>();
    for (const id of input.inferenceIds) {
      const inference = this.inferences.get(id);
      if (!inference) {
        throw new ProvenanceViolation(
          ViolationCode.VERDICT_CITES_MISSING_INFERENCE,
          `${input.module} cited inference ${id}, which was never derived`,
          { module: input.module, inferenceId: id },
        );
      }
      for (const evidenceId of inference.evidenceIds) evidenceIds.add(evidenceId);
    }

    const id = `vd_${createHash('sha256')
      .update([input.module, input.subject, input.value, ...[...input.inferenceIds].sort()].join(' '))
      .digest('hex')
      .slice(0, 24)}`;

    const verdict: Verdict<V> = {
      id,
      module: input.module,
      subject: input.subject,
      value: input.value,
      determinacy: input.determinacy,
      // An indeterminate verdict reports zero confidence by construction:
      // there is nothing for confidence to be *in*.
      confidence: input.determinacy === Determinacy.DETERMINED ? clamp01(input.confidence) : 0,
      rationale: input.rationale,
      inferenceIds: [...input.inferenceIds].sort(),
      evidenceIds: [...evidenceIds].sort(),
    };

    this.verdicts.set(id, verdict as Verdict);
    return verdict;
  }

  /** Record a pipeline step in the audit trail. */
  log(entry: Omit<AuditEntry, 'sequence'>): void {
    this.sequence += 1;
    this.trail.push({ sequence: this.sequence, ...entry });
  }

  auditTrail(): AuditEntry[] {
    return [...this.trail];
  }

  allInferences(): Inference[] {
    return [...this.inferences.values()];
  }

  allVerdicts(): Verdict[] {
    return [...this.verdicts.values()];
  }

  /**
   * Post-hoc audit of a completed result.
   *
   * `derive`/`conclude` prevent violations at construction; this catches
   * anything assembled by other means (a hand-built module, a deserialised
   * result, a future adapter) and is what the test suite asserts is empty.
   */
  static audit(
    ledger: EvidenceLedger,
    modules: readonly ModuleResult[],
    findings: readonly Finding[] = [],
  ): Violation[] {
    const violations: Violation[] = [];
    const inferenceIndex = new Map<string, Inference>();

    for (const module of modules) {
      for (const inference of module.inferences) {
        inferenceIndex.set(inference.id, inference);

        if (inference.evidenceIds.length === 0) {
          violations.push({
            code: ViolationCode.INFERENCE_WITHOUT_EVIDENCE,
            message: `Inference ${inference.rule} cites no evidence`,
            context: { inferenceId: inference.id },
          });
        }
        for (const evidenceId of inference.evidenceIds) {
          if (!ledger.has(evidenceId)) {
            violations.push({
              code: ViolationCode.INFERENCE_CITES_MISSING_EVIDENCE,
              message: `Inference ${inference.rule} cites evidence ${evidenceId}, absent from the ledger`,
              context: { inferenceId: inference.id, evidenceId },
            });
          }
        }
        if (!inRange(inference.confidence)) {
          violations.push({
            code: ViolationCode.CONFIDENCE_OUT_OF_RANGE,
            message: `Inference ${inference.rule} has confidence ${inference.confidence}`,
            context: { inferenceId: inference.id },
          });
        }
      }
    }

    for (const module of modules) {
      for (const verdict of module.verdicts) {
        if (verdict.determinacy === Determinacy.DETERMINED && verdict.inferenceIds.length === 0) {
          violations.push({
            code: ViolationCode.VERDICT_WITHOUT_INFERENCE,
            message: `Verdict ${verdict.value} for ${verdict.subject} has no supporting inference`,
            context: { verdictId: verdict.id, module: module.module },
          });
        }
        if (verdict.determinacy === Determinacy.DETERMINED && verdict.confidence <= 0) {
          violations.push({
            code: ViolationCode.DETERMINED_WITHOUT_CONFIDENCE,
            message: `Verdict ${verdict.value} is DETERMINED but reports zero confidence`,
            context: { verdictId: verdict.id },
          });
        }
        if (!inRange(verdict.confidence)) {
          violations.push({
            code: ViolationCode.CONFIDENCE_OUT_OF_RANGE,
            message: `Verdict ${verdict.value} has confidence ${verdict.confidence}`,
            context: { verdictId: verdict.id },
          });
        }

        const expected = new Set<string>();
        for (const inferenceId of verdict.inferenceIds) {
          const inference = inferenceIndex.get(inferenceId);
          if (!inference) {
            violations.push({
              code: ViolationCode.VERDICT_CITES_MISSING_INFERENCE,
              message: `Verdict ${verdict.value} cites inference ${inferenceId}, which does not exist`,
              context: { verdictId: verdict.id, inferenceId },
            });
            continue;
          }
          for (const evidenceId of inference.evidenceIds) expected.add(evidenceId);
        }
        // The verdict's evidence set must be exactly the union of what its
        // inferences cite. A verdict quietly carrying extra evidence ids would
        // let a report display support the reasoning never actually used.
        const declared = new Set(verdict.evidenceIds);
        if (expected.size !== declared.size || [...expected].some((id) => !declared.has(id))) {
          violations.push({
            code: ViolationCode.VERDICT_EVIDENCE_MISMATCH,
            message: `Verdict ${verdict.value} declares evidence that does not match its inferences`,
            context: { verdictId: verdict.id },
          });
        }
      }
    }

    for (const finding of findings) {
      const hasSupport = finding.evidenceIds.length > 0 || finding.inferenceIds.length > 0;
      // An EVIDENCE finding must name its support. An ABSENCE finding asserts
      // something about what the ledger lacks, so citing a record would be
      // incoherent - but it must declare that basis explicitly, which is what
      // keeps "unsupported" and "about absence" from being confused.
      if (finding.basis === FindingBasis.EVIDENCE && !hasSupport) {
        violations.push({
          code: ViolationCode.FINDING_WITHOUT_SUPPORT,
          message: `Finding ${finding.code} declares an evidence basis but cites nothing`,
          context: { code: finding.code },
        });
      }
      if (finding.basis === FindingBasis.ABSENCE && hasSupport) {
        violations.push({
          code: ViolationCode.FINDING_BASIS_MISMATCH,
          message: `Finding ${finding.code} claims an absence basis but cites support`,
          context: { code: finding.code },
        });
      }
      for (const evidenceId of finding.evidenceIds) {
        if (!ledger.has(evidenceId)) {
          violations.push({
            code: ViolationCode.FINDING_WITHOUT_SUPPORT,
            message: `Finding ${finding.code} cites evidence ${evidenceId}, absent from the ledger`,
            context: { code: finding.code, evidenceId },
          });
        }
      }
    }

    return violations;
  }
}

/** Inferences that reduce determinacy are excluded from directional mass. */
export const isDirectional = (inference: Inference): boolean =>
  inference.direction !== InferenceDirection.REDUCES_DETERMINACY;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const inRange = (value: number): boolean => Number.isFinite(value) && value >= 0 && value <= 1;
