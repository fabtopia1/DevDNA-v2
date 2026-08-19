# 5. Scoring methodology

The trust score is a **summary of the verdicts**, and the verdicts are a summary
of the evidence. Nothing enters the score that did not come up through that
chain, which is what makes the number reproducible from stored evidence alone.

## Shape of the calculation

```
  per-component / per-subject verdicts
              │
              ▼
  five pillar scores (0-100, or null if the module abstained)
              │  weighted by base weight × confidence damping
              ▼
  rawScore  ──────────────►  gates (caps, never subtractions)
                                        │
                                        ▼
                                  score = min(rawScore, lowest cap)
                                        │
                                        ▼
                          band → verdict → disclosure rule
```

## Pillars

| Pillar | Base weight | Why this weight |
|---|---|---|
| Service evidence | 0.30 | the question the market cannot answer for itself |
| Hardware consistency | 0.20 | physical substitution is the expensive fraud |
| Identity | 0.20 | if the identifiers don't cohere, nothing else attaches to a handset |
| SecurityDNA | 0.20 | a compromised OS can misreport every other value here |
| Battery intelligence | 0.10 | visible in Settings; a price adjustment, not a trust question |

**A module that abstained is excluded, not zeroed.** Scoring an abstention as
zero would punish a device for DevDNA's blind spots. Instead it drops out of the
weighted mean and reduces coverage, which is what the coverage gates and the
confidence threshold then act on.

Effective weights are confidence-damped and renormalised over the pillars that
scored:

```
effectiveWeight_i = baseWeight_i × (0.4 + 0.6 × confidence_i) / Σ (same, over scoring pillars)
rawScore = round( Σ score_i × effectiveWeight_i )
```

### Identity — binary in effect

`IDENTITY_CONSISTENT → 100`, `IDENTITY_MISMATCH → 10`, abstention → null.
Identifiers either cohere or they do not; there is no meaningful middle.

### Hardware consistency — degrades with anomalies

`SPECIFICATION_MATCH → 100`. Otherwise `max(10, 100 − Σ penalty)`, where a HIGH
severity anomaly costs 40 and anything lower costs 20.

### Service evidence — weighted by what the market prices

Component weights, normalised over the components that produced a verdict:

```
DISPLAY .24  BATTERY .18  FACE_ID .14  REAR_CAMERA .13  LOGIC_BOARD .10
FRONT_CAMERA .09  TOUCH_ID .06  REAR_HOUSING .05  LIDAR/SPEAKER/MIC .03
TAPTIC_ENGINE .02
```

Per component:

- `ORIGINAL_LIKELY` → 100
- `REPLACED_LIKELY` → scored by the **authenticity** of the part fitted:
  `GENUINE_APPLE 82 · GENUINE_TRANSPLANTED 68 · UNKNOWN 55 · NOT_VERIFIED 12`
- `CANNOT_DETERMINE` → excluded from both numerator and denominator

This is where the orthogonality of replacement and authenticity earns its keep.
Replacement alone is not a fault — a device serviced by Apple with a genuine
part is sound, it simply must be disclosed. What moves the score is *what was
fitted*, which is a different question and is stored as a different field.

### Battery — condition, not authenticity

Piecewise on Apple-equivalent maximum capacity, calibrated to how the trade
prices a cell rather than as a straight percentage:

| Health | Score |
|---|---|
| ≥ 100% | 100 |
| 90–99% | `88 + (h − 90) × 1.2` |
| 80–89% | `60 + (h − 80) × 2.8` |
| 70–79% | `30 + (h − 70) × 3` |
| 50–69% | `(h − 50) × 1.5` |
| < 50% | 0 |

It steepens below 80% because that is where a shop must price in a replacement.
Wear grade (A–E, demoted one step past rated cycle life) and replacement
likelihood are reported alongside but do not enter the score — they are
forecasts, and a forecast should not silently become a fact.

### SecurityDNA — posture score

Starts at 100 and takes itemised deductions, each recorded with a code, a point
cost, and a reason, so the deduction list *is* the explanation. Posture ≥ 85
with no integrity compromise is `POSTURE_CLEAN`.

## Verdict thresholds inside modules

The Service Evidence Engine, which carries the most weight, decides as follows.
`mass = Σ weight × confidence` on each side:

```
totalMass < 0.25                    → CANNOT_DETERMINE  (too weak to conclude)
no inferences at all                → CANNOT_DETERMINE  (nothing was obtainable)
replacedShare ≥ 0.45                → REPLACED_LIKELY
originalShare ≥ 0.60                → ORIGINAL_LIKELY
otherwise                           → CANNOT_DETERMINE
```

The asymmetry is intentional. Establishing that a part was replaced needs 0.45
of the directional mass; establishing that it is original needs 0.60. Claiming
originality is the stronger claim, because it is the one that adds value to a
sale, and **absence of evidence is never evidence of authenticity**.

## Gates

Gates **cap** the score. They never subtract, so a healthy battery can never buy
back an activation lock. Every gate that fires is logged to the audit trail and
raised as a finding.

| Gate | Cap | Fires when |
|---|---|---|
| `IDENTITY_MISMATCH` | 30 | identifiers contradict each other |
| `INTEGRITY_COMPROMISED` | 35 | jailbreak indicators present |
| `ACTIVATION_LOCK_ON` | 35 | Activation Lock enabled |
| `CRITICAL_PART_UNVERIFIED` | 45 | a critical component's part could not be verified by Apple |
| `HARDWARE_ANOMALY` | 50 | a HIGH severity specification anomaly |
| `PART_UNVERIFIED` | 68 | any other unverified replaced part |
| `MDM_SUPERVISED` | 70 | supervised or MDM-enrolled |
| `COVERAGE_INSUFFICIENT` | 78 | coverage < 0.35 |
| `BATTERY_BELOW_THRESHOLD` | 82 | health below Apple's 80% service threshold |
| `COVERAGE_PARTIAL` | 95 | coverage < 0.70 |
| `COVERAGE_NOT_TOTAL` | 97 | coverage < 0.90 |

The coverage ladder exists because a trust system printing a flat 100 is making
an absolute claim. A perfect score is reserved for inspections that actually saw
almost everything; an earlier version printed 100 at 85% coverage, which read as
"flawless" when it meant "flawless, as far as we looked".

Both `rawScore` and `score` are persisted, so a technician can see exactly what
the caps cost.

## Bands and the disclosure rule

```
score ≥ 85  TRUSTED
score ≥ 70  TRUSTED_WITH_NOTES
score ≥ 50  CAUTION
otherwise   UNTRUSTED

confidence < 0.45  →  INSUFFICIENT_EVIDENCE, whatever the score
```

Then one further rule:

> **Any component established as `REPLACED_LIKELY` downgrades `TRUSTED` to
> `TRUSTED_WITH_NOTES`. The score does not move.**

A device serviced by Apple with genuine parts is sound and legitimately scores
in the nineties. But a bare "TRUSTED" would let a reseller present a repaired
handset as untouched, and the disclosure is the entire point of the product.
The score says how good the device is; the verdict says what the buyer must be
told.

## Reproducibility

```ts
evaluate(ledger) → InspectionReport
```

Everything above is a pure function of the evidence ledger and the engine
version. The API stores the ledger, its digest, `engineVersion` and
`algorithmVersion`; `POST /v1/inspections/:id/rescore` verifies the digest and
the content-addressed ids, then recomputes.

A test asserts that a report recomputed from persisted evidence alone is
deep-equal to the original, audit trail included. That test is what the phrase
"every score must be reproducible from stored evidence" means in practice.

## Current fixture outcomes

| Fixture | Score | Verdict |
|---|---|---|
| pristine-15-pro | 97 | `TRUSTED` |
| serviced-14-pro | 95 | `TRUSTED_WITH_NOTES` |
| counterfeit-display-13 | 45 | `UNTRUSTED` |
| activation-locked-12 | 35 | `UNTRUSTED` |
| tampered-identity-13 | 30 | `UNTRUSTED` |
| legacy-sparse-8 | — | `INSUFFICIENT_EVIDENCE` |

All six produce zero provenance violations.
