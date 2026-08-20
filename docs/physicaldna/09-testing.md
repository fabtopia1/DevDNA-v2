# 9. Testing methodology

## What is tested today: 47 tests, no model required

The deterministic `MockDetector` means the entire pipeline around the model is
under test before any weights exist.

| Area | Tests | What they pin |
|---|---|---|
| Image metrics | 4 | Sharp vs blurred separated by >10×; motion is directional, defocus is not; glare is caught by clipping, not by mean brightness |
| Validation gate | 10 | Each rejection reason fires on its own failure; retake instructions name the actual problem; measurements survive on rejected results |
| Taxonomy | 3 | Unique ids, every surface covered, repair indicators trust-relevant and cosmetic wear not |
| Evidence adapter | 4 | Calibrated reliability recorded not model score; detections from failed images discarded; impossible surface/view pairs discarded; rejections recorded as failures |
| Module and scoring | 8 | Zero provenance violations on every path; uncalibrated cap; damage moves the score; noisy-OR saturation; abstention excluded not zeroed; insufficient evidence; wear/damage separation |
| Calibration | 7 | Ships uncalibrated; measured precision becomes reliability; partial benchmarks don't vouch for unmeasured classes; a thin benchmark isn't a measurement; a real grade appears once benchmarked |
| Explainability | 2 | All mandated fields present; ordered by score cost |
| Reproducibility | 3 | Identical assessment from stored evidence alone; idempotent; evidence and conclusions stay in separate layers |
| Report | 4 | Section renders; no score when insufficient; always states what was not assessed; discloses caps |

Three of these tests exist because they **caught real bugs** during
implementation:

- **Anisotropic blur passed the sharpness gate.** A smeared image can retain high
  total Laplacian variance from the intact axis. The isotropy check now runs
  independently rather than as a tie-breaker on soft images.
- **Pillar coverage overstated itself.** The camera pillar reported full coverage
  while scoring from the front camera alone, with the rear camera — 85% of the
  pillar — never photographed. Coverage is now weighted within the pillar.
- **The severe-damage gate keyed on pillars.** A structural crack took the front
  glass to 20, the display pillar averaged it to 68, and no gate fired. It now
  gates on surfaces.

The surface/view guard also rejected a physically impossible test fixture — a
crack on the display's active area rather than the front glass — which is the
guard working.

## Model validation, once a model exists

### Accuracy benchmarks

Measured on the **benchmark split: devices the model has never seen**, never on
held-out images of training devices.

| Metric | Reported at | Why |
|---|---|---|
| Per-class precision / recall | Class operating threshold | Feeds calibration directly |
| Per-class AP | IoU 0.5 | Comparable across runs |
| Mask IoU | Segmentation classes | Extent accuracy feeds the score |
| Per-surface mAP | Each of 7 surfaces | Catches a surface the model is blind on |
| Per-generation mAP | Each iPhone generation | Catches a generation gap in the data |
| Per-site mAP | Each collection site | Catches overfitting to one shop's lighting |

Aggregate mAP is reported but is **not** an acceptance criterion. It is dominated
by common classes and can improve while the classes that carry commercial value
get worse.

### False positive testing

A dedicated **clean-device set**: 200 devices verified defect-free by two
technicians, deliberately including hard negatives —

- reflections and specular highlights on glass,
- dust, fingerprints and lint,
- factory panel seams and chamfer highlights,
- screen protectors and their edges,
- manufacturing colour variation between panels.

Target: **< 2% of clean devices receive any defect finding.** A false positive
tells a shop its stock is damaged when it is not, and one of those does more
commercial damage than several misses.

### False negative testing

A **known-defect set**: 200 devices with defects catalogued by technicians,
stratified across every class and deliberately weighted toward the hard tail —
hairline cracks, non-OEM screws, lens scratches, early delamination.

Recall is measured per class and **published in the calibration artifact**,
because it is what a clean verdict's confidence rests on. There is no target for
aggregate recall; there is a floor per class below which the class is treated as
uncalibrated.

### Human reviewer comparison

The measurement that decides whether the product is worth selling.

Three technicians independently grade 300 devices from the photographs alone,
using the same taxonomy. Then:

| Comparison | What it tells us |
|---|---|
| Model vs consensus | Raw accuracy |
| Technician vs technician | **The ceiling.** The model cannot exceed human agreement on a class |
| Model vs individual technician | Whether the model is within the human spread |
| Model + technician review vs consensus | Whether the assisted workflow beats either alone |

The success condition is **"model agreement with consensus ≥ the median
technician's agreement with consensus"**, not "model beats humans". If humans
agree with each other only 70% of the time on a class, a model at 72% is at the
ceiling and the correct response is to fix the class definition, not to train
longer.

## Production readiness metrics

A model may be promoted to `production` only when **all** hold:

| # | Criterion | Threshold |
|---|---|---|
| 1 | Classes with measured calibration | ≥ 30 of 43, including every `trustRelevant` class |
| 2 | Per-class precision at operating threshold | ≥ 0.90 for every calibrated class |
| 3 | Per-class recall | ≥ 0.70 for functional classes; ≥ 0.55 for cosmetic |
| 4 | False positive rate on the clean set | < 2% of devices |
| 5 | Agreement with technician consensus | ≥ median technician agreement |
| 6 | Benchmark sample size | ≥ 50 held-out instances per calibrated class |
| 7 | Per-surface mAP | No surface below 60% of the best surface |
| 8 | Inference latency | p95 < 2s for a 10-image session |
| 9 | Provenance violations | Zero across the full benchmark corpus |
| 10 | Calibration artifact attached in the registry | Present, with real `benchmarkVersion` |

Criterion 1 deserves emphasis: **shipping with 30 of 43 classes calibrated is
expected and correct.** The remaining classes continue to behave as uncalibrated
— detections are still recorded as evidence, they simply carry low reliability
and the report shows the reduced coverage. Partial capability, honestly
reported, beats full capability dishonestly claimed.

## Drift monitoring in production

The fleet metrics that matter, none of which need labels:

- **Detection rate per class per week.** A step change means the model, the
  capture flow, or the stock changed.
- **Validation rejection rate per view.** Rising rejection on one view means the
  capture instruction is failing, not the technicians.
- **Abstention rate per surface.** The physical analogue of SoftwareDNA's
  "where the engine is blind" panel.
- **Grade distribution vs the shop's own grading.** Systematic divergence from a
  refurbisher's internal grades is the earliest available signal of drift.
- **Technician override rate**, once the review UI exists. The strongest signal
  of all, and free.
