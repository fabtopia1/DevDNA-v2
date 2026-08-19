# 2. Domain model

Four types carry the whole system. They are deliberately separate, and the
separation is enforced rather than conventional.

```
EvidenceRecord   what was observed          (fact)
      ▲
      │ cited by
Inference        what that suggests         (claim)
      ▲
      │ cited by
Verdict          what we conclude           (conclusion)
      ▲
      │ aggregated into
TrustAssessment  what it adds up to         (summary)
```

## `EvidenceRecord` — a fact

```ts
interface EvidenceRecord {
  id: string;              // content-addressed: ev_<24 hex>
  kind: EvidenceKind;      // DEVICE_PROPERTY | MEASUREMENT | COLLECTION_FAILURE | …
  subject: EvidenceSubject;// DEVICE | BATTERY | DISPLAY | SECURITY_STATE | …
  key: string;             // 'ProductType', 'CycleCount', 'ServiceHistoryLabel'
  value: string | number | boolean | null;
  provenance: Provenance;  // required, always
  raw?: string;            // verbatim excerpt for the audit trail
  note?: string;           // human-readable restatement
}
```

An evidence record contains **no verdict, no score, and no interpretation**. It
is what a collector saw.

## `Provenance` — where a fact came from

```ts
interface Provenance {
  source: EvidenceSource;      // which authority
  method: CollectionMethod;    // how it was obtained
  observedAt: string;          // ISO-8601 instant
  reliability: number;         // 0..1 trust in this CHANNEL
  collector: string;           // which collector produced it
  instrument?: string;         // tool and version
}
```

`reliability` is a property of the **channel**, not of the value. A perfectly
read number from a channel known to go stale still carries the channel's
reliability. See [04-confidence-model.md](04-confidence-model.md).

## `Inference` — a claim

```ts
interface Inference {
  id: string;                    // in_<24 hex>
  module: ModuleId;
  rule: string;                  // 'identity.imei-checksum-invalid'
  subject: EvidenceSubject;
  direction: InferenceDirection; // SUPPORTS_POSITIVE | SUPPORTS_NEGATIVE | REDUCES_DETERMINACY
  statement: string;             // plain language, printed on reports
  weight: number;                // 0..1 how far this moves a verdict
  confidence: number;            // 0..1 belief in this reasoning step
  evidenceIds: string[];         // NON-EMPTY. Enforced at construction.
  derivedAt: string;
}
```

`weight` and `confidence` are separate on purpose. A very strong indicator read
from a flaky channel is not the same as a weak indicator read reliably.

## `Verdict` — a conclusion

```ts
interface Verdict<V extends string> {
  id: string;                // vd_<24 hex>
  module: ModuleId;
  subject: EvidenceSubject;
  value: V;                  // the module's own vocabulary
  determinacy: Determinacy;  // DETERMINED | INDETERMINATE
  confidence: number;        // 0 for INDETERMINATE, by construction
  rationale: string;         // one sentence a technician can repeat
  inferenceIds: string[];    // non-empty when DETERMINED
  evidenceIds: string[];     // exactly the union of the inferences' evidence
}
```

An `INDETERMINATE` verdict reports **zero** confidence. There is nothing for
confidence to be *in*: the engine did not conclude.

## `Finding` — a surfaced concern

```ts
interface Finding {
  code, severity, module, title, detail;
  basis: FindingBasis;       // EVIDENCE | ABSENCE
  evidenceIds: string[];
  inferenceIds: string[];
}
```

`basis` exists because some of the most important findings — *"no attestation
was captured"*, *"coverage is too low"*, *"Activation Lock could not be
determined"* — are claims about what the ledger **lacks**, and by construction
can cite nothing. Modelling absence explicitly keeps "unsupported" and "about
absence" distinct, and the audit rejects either one masquerading as the other.

## Separation of replacement from authenticity

The Service Evidence Engine answers exactly one question — *was this component
replaced?* — with exactly three values. Whether the part fitted is genuine is a
**separate annotation**:

```ts
enum PartAuthenticity {
  GENUINE_APPLE, GENUINE_TRANSPLANTED, NOT_VERIFIED, UNKNOWN
}
```

This encodes a correction that changes verdicts. iOS populates Parts and Service
History **only when a service record exists**. A component listed there was
serviced — *including when it is labelled "Genuine Apple Part"*. That label
describes the authenticity of the part fitted, not whether the component is
original to the device.

Conflating the two is the most common error in this market, and it
systematically overvalues serviced handsets. Keeping them orthogonal means a
device serviced by Apple with genuine parts scores well and is still disclosed
as serviced.

## Ledger

```ts
class EvidenceLedger {
  record(input): EvidenceRecord            // dedupes by content-addressed id
  recordFailure(input): EvidenceRecord     // failures are evidence
  best(subject, key): EvidenceRecord | undefined   // most reliable, never a failure
  string/number/boolean(subject, key)      // undefined, never a default
  failures(subject, key?): EvidenceRecord[]
  digest(): string                         // over record CONTENT
  verifyIntegrity(): { ok, mismatched[] }  // recompute ids from content
  clone(): EvidenceLedger
}
```

`best()` never returns a collection failure as a value: a failure is evidence
that we could not read something, not a reading.

## Module output

```ts
interface ModuleResult<V> {
  module: ModuleId;
  verdicts: Verdict<V>[];
  inferences: Inference[];
  coverage: number;    // share of what it set out to assess that it could
  confidence: number;  // aggregate belief across determined verdicts
  detail?: Record<string, unknown>;   // e.g. battery wear grade, anomaly list
}
```

**Coverage and confidence are reported separately and never merged.** A
confident verdict about 10% of a device is not the same as a confident verdict
about all of it, and collapsing them into one number hides exactly the thing a
buyer needs to know.
