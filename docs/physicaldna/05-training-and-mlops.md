# 5. Training pipeline and MLOps

## The pipeline

```
 annotations (CVAT)
        │  export COCO
        ▼
 ┌─────────────────┐
 │ dataset build   │  validate schema · device-keyed split · materialise
 └────────┬────────┘
          │  fails the build on: unknown class, device in two splits,
          │  unvalidated image, class below the 300-instance floor
          ▼
 ┌─────────────────┐
 │ dataset audit   │  per-class counts, agreement, split balance
 └────────┬────────┘
          ▼
 ┌─────────────────┐
 │    training     │  config-driven; run logged with dataset digest
 └────────┬────────┘
          ▼
 ┌─────────────────┐
 │   evaluation    │  mAP, PR curves, per-class, per-surface, per-generation
 └────────┬────────┘
          ▼
 ┌─────────────────┐
 │   BENCHMARK     │  held-out devices → precision/recall at operating point
 └────────┬────────┘
          │
          ▼
   calibration.json  ──────►  packages/physical  loadCalibration()
```

The last arrow is the whole point. **The pipeline does not produce a score.** It
produces a detector and an honest measurement of how often that detector is
right. Everything that turns detections into a number lives in TypeScript, is
deterministic, and is unit tested.

## Ingestion and cleaning

`ml/physicaldna/dataset.py` validates every record against a Pydantic schema and
**fails the build** rather than warning, on:

| Check | Why it is fatal |
|---|---|
| Unknown class id | The label map and the scorer have diverged; nothing downstream is trustworthy |
| Device in two splits | Silent leakage; the benchmark becomes a lie |
| Image that failed production validation | Training on inputs production refuses teaches confident predictions on exactly the images we refuse to trust |
| Class below 300 instances | The model learns the devices, and the benchmark is too small to notice |
| Unreviewed `UNCLASSIFIED_ANOMALY` | An unreviewed anomaly is an unanswered taxonomy question |

## Augmentation

Deliberate about what is *not* augmented, which matters more than what is.

**Geometry — applied freely.** Flips, ±15° rotation, scale 0.4, translation. A
scratch is a scratch upside down.

**Photometric — applied strongly.** Hue, saturation and value jitter. Shop
lighting is the single largest source of domain shift between collection sites
and the field, and it is the cheapest to simulate.

**Mosaic — on, then off for the last 20 epochs.** It fabricates defect
adjacencies that never occur on a real device and hurts small-object
localisation; closing it late recovers that.

**Blur and noise — deliberately NOT applied.** Production rejects blurred images
at the validation gate. Training the model to cope with blur teaches it to make
confident predictions on exactly the inputs the system has decided not to trust,
and those predictions would then arrive as evidence with a calibrated reliability
measured on sharp images. This is the augmentation that looks obviously correct
and is actively harmful.

## Calibration: the artifact that ships

```python
def choose_operating_threshold(curve, target_precision=0.9) -> float:
    """Lowest threshold still meeting the precision target."""
```

**Per class, not global.** Hairline cracks and shattered glass do not share an
operating point; one global threshold guarantees one class over-triggers while
another is silent.

**Precision-targeted, not F1-optimal.** The costs are asymmetric: a false
positive tells a shop its stock is damaged when it is not, and one of those does
more commercial damage than several misses.

Output, per class:

```jsonc
{ "classId": "CRACK_STRUCTURAL", "operatingThreshold": 0.62,
  "precision": 0.94, "recall": 0.88,
  "sampleSize": 412, "benchmarkVersion": "benchmark-2026.1" }
```

`precision` becomes the evidence reliability for a detection. `recall` becomes
the confidence of a **clean** verdict. That asymmetry is deliberate and is
described in [06-scoring-engine.md](06-scoring-engine.md#the-recall-asymmetry).

A class with fewer than 50 held-out instances is emitted with its real
`sampleSize` and continues to be treated as **uncalibrated** by the engine —
visible under-coverage rather than a borrowed number.

## MLOps

```
  ┌────────────┐   ┌──────────────┐   ┌───────────────┐   ┌──────────────┐
  │    CVAT    │──►│ S3 datasets  │──►│ training (GPU)│──►│    MLflow    │
  │ annotation │   │ + manifests  │   │  spot A10G    │   │ runs+registry│
  └────────────┘   └──────────────┘   └───────────────┘   └──────┬───────┘
                                                                  │ promote
                                                                  ▼
                                                          ┌──────────────┐
                                                          │ Triton / GPU │
                                                          │  inference   │
                                                          └──────────────┘
```

**Experiment tracking — MLflow.** Every run logs the config, the taxonomy
version, the **dataset manifest digest**, git SHA, full metrics and the PR curves.
A run that cannot name the exact data it saw is not reproducible, and the digest
is what makes that checkable rather than asserted.

**Model registry — MLflow Model Registry.** Stages: `staging` → `benchmarked` →
`production`. A model cannot reach `production` without an attached calibration
artifact; that gate is what makes the "no uncalibrated model ships" rule
mechanical instead of cultural.

**Dataset versioning — manifests in S3, content-addressed images.** Considered
DVC and rejected: the manifest *is* the dataset, images are already immutable and
content-addressed, and a second tool with its own metadata store adds a way for
the two to disagree.

**Retraining cadence.** Monthly while data volume is growing, then triggered by:
+15% new instances in any class, a taxonomy version bump, or a monitored drift
signal ([09-testing.md](09-testing.md)).

**Rollback.** The calibration artifact and the weights are versioned separately
and both are just data. Rolling back a bad release is loading the previous
calibration and repointing the inference service — no deploy, no migration. The
engine's `resetCalibration()` returns it to declining to grade, which is the
correct behaviour when no trustworthy model is available.

## Reproducibility, end to end

| Artifact | Pinned by |
|---|---|
| Data | manifest digest, content-addressed images |
| Labels | taxonomy version, generated from TypeScript |
| Code | git SHA |
| Config | logged verbatim to MLflow |
| Weights | MLflow registry version |
| Accuracy claims | benchmark version in the calibration artifact |
| **Scores** | **the evidence ledger — recomputable without any of the above** |

The last row is the one that matters commercially. A physical assessment from
eight months ago can be re-derived from its stored evidence with no images, no
weights, and no inference service — which is what makes it defensible in a
dispute. Asserted by test:

```
✓ reproducibility > recomputes an identical assessment from the stored evidence alone
✓ reproducibility > is idempotent: evaluating the same ledger twice gives the same answer
```
