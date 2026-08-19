# 6. Audit model

Two different things are called "audit" here, and they are kept apart:

- the **reasoning audit** — how one inspection reached its verdict, and whether
  every conclusion in it is supported;
- the **operational audit log** — who did what in the application.

Both are persisted. Only the first is part of the trust argument.

## Reasoning audit

### The audit trail

`ProvenanceEngine.log()` appends an ordered entry for every meaningful step:

```ts
interface AuditEntry {
  sequence: number;                  // strictly increasing, per inspection
  at: string;
  module: ModuleId | 'PIPELINE';
  action: 'EVIDENCE_COLLECTED' | 'INFERENCE_DERIVED' | 'VERDICT_CONCLUDED'
        | 'MODULE_COMPLETED' | 'SCORE_COMPUTED' | 'GATE_APPLIED';
  summary: string;                   // plain language
  refs: { evidenceIds?, inferenceIds?, verdictIds? };
}
```

A representative trail reads:

```
1  PIPELINE  EVIDENCE_COLLECTED  184 evidence records available for evaluation
2  IDENTITY  INFERENCE_DERIVED   identity.imei-checksum-valid: The IMEI passes its Luhn check
…
41 SERVICE   INFERENCE_DERIVED   service.listed-in-service-history: iOS lists this component…
42 SERVICE   MODULE_COMPLETED    12 subjects assessed, 2 replaced, 6 indeterminate
…
57 TRUST     SCORE_COMPUTED      Weighted pillar score 95 at confidence 0.87 over 5 of 5 pillars
58 TRUST     GATE_APPLIED        PART_UNVERIFIED capped the trust score at 68: …
59 TRUST     MODULE_COMPLETED    Trust verdict TRUSTED_WITH_NOTES at score 68 (raw 95, 1 gate(s))
```

Because the trail is produced by the same pure evaluation that produces the
score, it is reproducible: re-scoring a stored ledger regenerates it identically,
which is asserted by test.

Served at `GET /v1/inspections/:id/audit`.

### Construction-time enforcement

The Provenance Engine refuses to build an unsupported conclusion. These throw:

| Code | Condition |
|---|---|
| `INFERENCE_WITHOUT_EVIDENCE` | `derive()` called with no evidence ids |
| `INFERENCE_CITES_MISSING_EVIDENCE` | a cited id is not in the ledger |
| `VERDICT_WITHOUT_INFERENCE` | a `DETERMINED` verdict citing no inference |
| `VERDICT_CITES_MISSING_INFERENCE` | a cited inference was never derived |

An `INDETERMINATE` verdict is always permitted. Refusing to conclude is a
legitimate outcome and must never be blocked by a validation rule — that is what
makes `CANNOT_DETERMINE` first-class rather than a fallback.

Note what `conclude()` does silently: it computes a verdict's `evidenceIds` as
the union of its inferences' evidence, rather than accepting a list. A verdict
cannot carry evidence its reasoning never used.

### Post-hoc audit

`ProvenanceEngine.audit(ledger, modules, findings)` re-checks a finished result
from the outside and returns `Violation[]`. It catches anything assembled by
other means — a hand-built module, a deserialised result, a future adapter —
and adds three checks construction cannot make:

| Code | Condition |
|---|---|
| `VERDICT_EVIDENCE_MISMATCH` | declared evidence ≠ union of the inferences' evidence |
| `DETERMINED_WITHOUT_CONFIDENCE` | a `DETERMINED` verdict reporting zero confidence |
| `CONFIDENCE_OUT_OF_RANGE` | any confidence outside 0..1 |
| `FINDING_WITHOUT_SUPPORT` | an `EVIDENCE`-basis finding citing nothing, or citing an absent record |
| `FINDING_BASIS_MISMATCH` | an `ABSENCE`-basis finding that cites support |

The result is carried on every report as `provenanceViolations`. It is
**surfaced, not thrown**: one bad rule degrades one report instead of failing
the inspection, and the violation is visible rather than silent.

The test suite asserts this array is empty for every fixture. That assertion is
the real statement of "no unsupported conclusions allowed".

### Findings and the basis field

Some of the most important findings are claims about what the ledger *lacks*:
*no attestation was captured*, *coverage is too low*, *Activation Lock could not
be determined*. By construction they can cite nothing.

```ts
enum FindingBasis { EVIDENCE, ABSENCE }
```

Modelling absence explicitly is what keeps "unsupported" and "about absence"
distinct. The audit then rejects either one masquerading as the other, which is
stronger than simply exempting uncited findings: an `EVIDENCE` finding that
cites nothing is still a violation.

This came out of a real failure — the first version of the audit flagged three
to four violations per fixture, all of them findings about absence with nothing
to cite. The fix was to model the distinction, not to relax the rule.

### Integrity of the stored evidence

```
ledgerDigest        sha256 over every record's content, stored on the inspection
verifyIntegrity()   recompute each content-addressed id from its stored fields
```

Re-scoring checks both and refuses to proceed on mismatch. Together they make a
different guarantee from the audit trail: the trail shows the reasoning was
sound *given* the evidence; the digest shows the evidence is the same evidence.

The digest is printed on the public verification page, so anyone holding a
report can see which ledger it was computed from.

## Operational audit log

`audit_logs` records actor, action, subject, IP, user agent and timestamp for
every state-changing operation: authentication, bridge registration and
revocation, inspection ingestion, report generation, re-scoring, user
management. It is scoped by `organizationId` like everything else, indexed on
`(organizationId, createdAt)` and `action`, and is append-only in use — no
application code path updates or deletes a row.

Re-scoring writes to both audits: an entry here recording who triggered it, and
a complete new reasoning trail on the inspection.

## What an auditor can do with all this

Given only a database dump, a third party can:

1. verify the evidence has not been altered (`verifyIntegrity`, `ledgerDigest`);
2. re-run `evaluate()` at the recorded `engineVersion` and get the same score;
3. read the trail to see which rule fired on which record;
4. confirm no conclusion lacks support (`audit()` returns empty);
5. see who ran what and when (`audit_logs`).

That sequence is the product. A trust claim nobody can check is a marketing
claim.
