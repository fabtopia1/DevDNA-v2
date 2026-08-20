# PhysicalDNA — blueprint

SoftwareDNA answers *is this device what it claims to be?* PhysicalDNA answers
*what condition is it actually in?* They are different questions with different
failure modes, and the second one is answered from photographs — which means it
must be built so that a neural network never becomes the thing being trusted.

The organising decision is one sentence:

> **The detector is a sensor, not a judge.**

libimobiledevice reads a battery register; the detector reads a photograph.
Neither is trusted to decide what its reading *means*. A detection becomes an
`EvidenceRecord` — located, versioned, content-addressed — and every conclusion
drawn from it cites the specific record it rests on. Everything downstream of
the model is deterministic, auditable, and unit tested.

## Documents

| # | Document | Requested deliverables covered |
|---|---|---|
| 1 | [System architecture](01-system-architecture.md) | 1 |
| 2 | [Dataset architecture and collection](02-dataset-architecture.md) | 2, 3, 4 |
| 3 | [Defect taxonomy](03-defect-taxonomy.md) | 5 |
| 4 | [Model comparison](04-model-comparison.md) | 6 |
| 5 | [Training pipeline and MLOps](05-training-and-mlops.md) | 7, 8 |
| 6 | [Scoring engine](06-scoring-engine.md) | 9 |
| 7 | [Explainability](07-explainability.md) | 10 |
| 8 | [Integration with SoftwareDNA](08-integration.md) | 11 |
| 9 | [Testing methodology](09-testing.md) | 12 |
| 10 | [Roadmap](10-roadmap.md) | 13 |
| 11 | [Risks and limitations](11-risks.md) | 14 |
| 12 | [First production version](12-first-production-version.md) | 15 |

## What is already built

`packages/physical` — **47 tests**, all passing:

| Layer | State |
|---|---|
| Defect taxonomy: 43 classes, versioned, with annotation rules | complete |
| Guided capture plan: 10 views, per-view thresholds, surface constraints | complete |
| Image validation: sharpness, motion, exposure, glare, framing | complete |
| Detector interface + calibration model + deterministic mock | complete |
| Evidence adapter: detections → the SoftwareDNA ledger | complete |
| Condition module: evidence → inferences → verdicts | complete |
| Scoring engine: pillars, gates, grades, coverage | complete |
| Explainability and report rendering | complete |
| **The detector itself** | **not started — no data exists** |

The engine runs end to end today and **refuses to issue a grade**, because no
model has been benchmarked. That is the system working, not a gap: it will start
grading the moment a calibration artifact with real sample sizes is loaded, and
not one moment before. See [12](12-first-production-version.md).
