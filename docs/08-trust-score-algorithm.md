# 8. Trust score algorithm

`TRUST_ALGORITHM_VERSION = 1.0.0` — persisted on every inspection so a
historical report stays explainable by the code that produced it.

## Inputs

Three pillar scores, each 0–100, each with its own 0–1 confidence:

| Pillar | Base weight | Why |
|---|---|---|
| Parts authenticity | **0.45** | The question the market cannot answer for itself. Battery health and iOS version are visible in Settings; a swapped display is not. |
| Battery | 0.30 | What the trade actually prices after authenticity. |
| Software | 0.25 | Mostly correctable by the seller, so it moves the number least. |

## Step 1 — confidence damping

A pillar we are unsure about should influence the result less, but must never
fall out of it entirely:

```
effectiveWeight_i = baseWeight_i × (0.4 + 0.6 × confidence_i)
weight_i          = effectiveWeight_i / Σ effectiveWeight
rawScore          = Σ weight_i × score_i
```

The 0.4 floor stops a low-confidence pillar from being silently ignored — a
device whose parts we could barely assess should not quietly become a
battery-and-software score wearing a trust badge.

## Step 2 — gates (caps, not subtractions)

Gates are **caps**. A device with Activation Lock enabled cannot be "mostly
fine" because its battery is healthy, and subtracting points would let a good
battery buy back a fatal defect.

| Gate | Cap | Reason |
|---|---|---|
| `ACTIVATION_LOCK_ON` | **35** | Cannot be resold until removed |
| `JAILBREAK_SUSPECTED` | **40** | A modified OS can falsify every other value here |
| `CRITICAL_PART_UNKNOWN` | **45** | Non-genuine display, Face ID or logic board |
| `NOT_ACTIVATED` | 60 | Inspection could not complete |
| `PART_UNKNOWN` | 68 | Non-genuine non-critical component |
| `MDM_SUPERVISED` | 70 | May re-enrol after erase — a resale blocker |
| `PARTS_COVERAGE_INSUFFICIENT` (<35%) | 78 | Cannot certify what it did not see |
| `BATTERY_BELOW_SERVICE_THRESHOLD` (<80%) | 82 | Apple's own service threshold |
| `PARTS_COVERAGE_PARTIAL` (<70%) | 95 | A perfect score requires broad coverage |

`score = min(rawScore, min(all caps))`. Every gate that fires is stored and
rendered with its reason, on screen and on the PDF — a technician can always
see exactly why a number was held down.

The 95 cap deserves a note: without it, the pristine fixture scored a flat
**100** while a third of the device had never been assessed. A report that
reads as flawless when it is merely incomplete is the failure mode this product
cannot afford.

## Step 3 — status band

```
confidence = Σ weight_i × confidence_i

if confidence < 0.45           → INCONCLUSIVE
else if score ≥ 85             → VERIFIED
else if score ≥ 70             → VERIFIED_WITH_NOTES
else if score ≥ 50             → CAUTION
else                           → FLAGGED
```

**`INCONCLUSIVE` outranks the score.** A thin inspection is never presented as
a pass, whatever it scored. Reporting "Verified" off weak evidence is the one
failure mode that would destroy the product's reason to exist.

## Worked examples (real engine output)

| Fixture | Battery | Software | Parts | Raw | Gates | **Final** | Status |
|---|---|---|---|---|---|---|---|
| iPhone 15 Pro, pristine | 99 | 100 | 100 | 100 | coverage 66% → 95 | **95** | VERIFIED |
| iPhone 14 Pro, Apple-serviced | 85 | 97 | 93 | 91 | — | **91** | VERIFIED |
| iPhone 13, third-party parts | 42 | 89 | 34 | 53 | critical part → 45 | **45** | FLAGGED |
| iPhone 12, activation locked | 75 | 100 | 100 | 91 | lock → 35 | **35** | FLAGGED |
| iPhone 8, minimal data | 0 | 97 | 0 | 42 | coverage → 78 | 42 | **INCONCLUSIVE** (conf 0.39) |

The activation-locked row is the algorithm working as intended: a genuinely
good handset, correctly scored 91 on condition, correctly reported as
untradeable.

### A note on the brief's illustrative example

The brief suggested battery 90 / software 95 / parts 85 → 90, which is the
plain arithmetic mean. This algorithm returns **89** for those inputs, because
parts are weighted above battery above software. That divergence is deliberate:
an equal-weight mean says a swapped display matters exactly as much as a
pending iOS update, and the resale market does not price them that way. Weights
live in `TRUST_WEIGHTS` and are a one-line change if an operator disagrees.

## Battery sub-score

```
batteryScore = 0.72 × health + 0.20 × cycles + 0.08 × condition
```
renormalised across whichever components are available, so a missing cycle
count lowers *confidence* rather than scoring zero.

**Health curve** (piecewise, calibrated to how the trade values a cell):

| Max capacity | 100% | 95% | 93% | 90% | 85% | 80% | 75% | 70% | ≤50% |
|---|---|---|---|---|---|---|---|---|---|
| Component | 100 | 94 | 91.6 | 88 | 74 | 60 | 45 | 30 | 0 |

The gradient steepens below 80% because that is Apple's *Service Recommended*
threshold and the point at which a shop must price in a replacement.

**Cycle curve**, normalised against the model's rated life (1000 cycles for
iPhone 15 and later, 500 before):

```
ratio ≤ 1 :  100 − 55 × ratio      (floor 45)
ratio > 1 :   45 − 35 × (ratio−1)  (floor 10)
```

The floor is 10, not 0: a cell at its rated life still works.

## Software sub-score

Starts at 100 and deducts:

| Condition | Penalty |
|---|---|
| Jailbreak indicators | −45 and `CRITICAL` finding |
| iOS ≥2 major versions behind supported | up to −22 |
| iOS 1 major version behind | −8 |
| Train no longer receiving security updates | −12 |
| Storage >95% full | −8 · >85% → −3 |
| Developer Mode enabled | −4 |
| Point release behind | −3 |

"Behind" is measured against the newest train the *device* supports, not the
newest that exists — an iPhone 8 on 16.7.11 is fully current and is not
penalised.

Software confidence counts four coverage signals, including whether the
diagnostics relay answered: if it stayed silent, our view of the software state
genuinely is less complete, and the number says so.

## Re-scoring

Because the raw snapshot is stored verbatim and both `engineVersion` and
`algorithmVersion` are persisted, any inspection can be re-scored under an
improved engine. This creates a **new** inspection record — a report already in
a trading partner's hands must keep saying what it said.
