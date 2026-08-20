# 6. PhysicalDNA scoring engine

Implemented in `packages/physical/src/scoring.ts`. Pure, deterministic, and a
function of the evidence ledger alone.

## Pillars

| Pillar | Weight | Surfaces (within-pillar weight) |
|---|---|---|
| Display condition | **30%** | Display active area (0.6), front glass (0.4) |
| Frame condition | **20%** | Frame (0.8), charge port (0.2) |
| Camera condition | **20%** | Rear camera (0.85), front camera (0.15) |
| Rear glass condition | **15%** | Rear glass (1.0) |
| Body wear | **15%** | WEAR-group defects across front glass, rear glass, frame |

## Damage and wear are scored separately

Body wear has no surfaces of its own. It is assembled from the WEAR-group
defects found on surfaces the other pillars already cover, and those classes are
excluded from the damage pillars entirely.

This is the domain-specific rule that matters most. A handset with heavy pocket
wear and nothing broken is a completely different commercial proposition from one
with a pristine finish and a cracked lens. A single "condition" number that
cannot tell them apart is useless to the people who trade them — and it is how
the trade actually grades: *"Grade A: no damage, light wear."*

Charging the same scratch field to both the rear-glass pillar and the body-wear
pillar would also be double counting. Asserted by test:

```ts
// Heavy wear on the rear glass:
expect(rearGlass.score).toBe(100);   // damage pillar untouched — nothing is broken
expect(bodyWear.score).toBeLessThan(100);
```

## Defect accumulation is noisy-OR

```
penalty = 1 − Π (1 − severity_i × extent_i)
surfaceScore = round(100 × (1 − penalty))
```

The same combiner the confidence model uses for independent corroboration, and
it saturates — which is the behaviour the domain needs.

A linear sum would drive a well-used but sound handset toward zero while a single
structural crack, the thing that actually sets the price, barely moved the
number. Ten scratches must be worse than one and nowhere near ten times worse:

```
✓ saturates rather than accumulating linearly across many light defects
```

## Extent

```
extentFactor = 0.35 + 0.65 × min(1, relativeArea / 0.06)
```

**The 0.35 floor** keeps a small defect from rounding away to nothing. A 2mm chip
in the corner of a screen is genuinely damage; a purely area-proportional model
prices it at almost zero. Extent modulates how much *worse* than the minimum a
defect is, not whether it counts.

**The 6% reference** is where severity saturates. Beyond it the difference
between a crack across half the panel and one across all of it does not decide
the price — the panel is being replaced either way.

## Missing evidence is excluded, never zeroed

A surface with no usable photograph:

- produces `CANNOT_DETERMINE` at **zero** confidence,
- drops out of the weighted mean rather than scoring 0,
- **reduces coverage**,
- and is named explicitly in the report.

Scoring an unphotographed rear panel as though it were destroyed would punish a
device for DevDNA's blind spot. Reporting it as fine would be worse.

**Pillar coverage is weighted within the pillar**, which a test caught. The
camera pillar can score from the front camera alone while the rear camera — 85%
of what the pillar is about — was never usably photographed. Reporting that as
full coverage would be exactly the failure this system exists to prevent.

## Gates cap, they do not subtract

| Gate | Cap | Fires when |
|---|---|---|
| `DETECTOR_UNCALIBRATED` | **84** | No benchmark has measured this detector |
| `<SURFACE>_DESTROYED` | 40 | Any assessable surface scores < 20 |
| `<SURFACE>_SEVERE_DAMAGE` | 55 | Any assessable surface scores < 40 |
| `COVERAGE_INSUFFICIENT` | 70 | Coverage < 40% |
| `COVERAGE_PARTIAL` | 90 | Coverage < 70% |
| `COVERAGE_NOT_TOTAL` | 96 | Coverage < 95% |

A flawless frame cannot buy back a shattered screen.

**Severe damage gates on the surface, not the pillar** — also caught by a test. A
structural crack takes the front glass to 20, but the display pillar averages it
with a perfect active area and lands at 68, comfortably above any pillar
threshold. The device has a smashed screen and the pillar arithmetic hid it. A
destroyed surface is a fact about the device that averaging against its
neighbours must not dilute.

### The uncalibrated gate

The least popular gate internally and the most important.

An unvalidated detector has an unknown false-negative rate, so *"we found
nothing"* carries unknown weight. Awarding a top grade on that basis would be the
most damaging thing this system could do to itself: the first customer handed a
"PRISTINE" handset with an obvious crack would be right to stop believing every
other number DevDNA prints, including the SoftwareDNA ones that **are** measured.

It removes itself automatically when a benchmark run lands.

## Confidence, and the recall asymmetry

Confidence propagates exactly as it does in SoftwareDNA: channel reliability →
inference confidence → verdict confidence → pillar → overall, weakest-link at
each step, measured over the **whole** intended picture so an abstaining pillar
contributes zero at full weight.

What is specific to this domain:

> **Precision bounds what a detection means. Recall bounds what an *absence*
> means.**

A "no damage on this surface" verdict is entirely a claim about absence, so its
confidence is the detector's measured **recall** on the weakest class that can
appear on that surface — not its precision, and never its softmax.

```ts
// A high-precision, low-recall detector:
loadCalibration(measured(precision: 0.95, recall: 0.4));
// ...can score damage it finds, but cannot vouch for cleanliness.
expect(report.score.confidence).toBeLessThan(0.6);
```

Until recall is measured, clean-surface rule confidence is **0.35**. That is what
makes the founding rule — *absence of evidence is not evidence of soundness* —
apply to photographs exactly as it applies to service records.

## Grades

| Grade | Score |
|---|---|
| Pristine | 97–100 |
| Excellent | 85–96 |
| Good | 70–84 |
| Fair | 50–69 |
| Poor | 25–49 |
| Heavily damaged | 0–24 |
| **No grade issued** | confidence < 0.45, whatever the score |

The last row is the same 0.45 reporting threshold SoftwareDNA uses, for the same
reason: below it there is nothing a number could honestly summarise.

## What it does today

Running the complete engine right now, with every view captured and validated:

```
Overall Condition:      No grade issued
PhysicalDNA Score:      — (insufficient evidence)
Inspection Confidence:  38%
Device Coverage:        100%

Limits on this assessment:
  - The defect detector has no measured precision or recall on a held-out
    benchmark, so the absence of a detection cannot yet support a top grade.
```

100% coverage, zero provenance violations, and **no grade** — because the model
does not exist. Load a benchmarked calibration and the same input scores in the
nineties. Both behaviours are tested.
