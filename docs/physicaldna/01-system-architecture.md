# 1. System architecture

## Layers

```
  ┌──────────────────┐
  │  guided capture  │  10 views, per-view framing and display state
  └────────┬─────────┘
           │  LumaImage + view + sha256
           ▼
  ┌──────────────────┐
  │   validation     │  sharpness · motion · exposure · glare · framing
  └────────┬─────────┘  ← REJECTS HERE. Rejections are recorded, not dropped.
           │  only accepted images continue
           ▼
  ┌──────────────────┐
  │    detection     │  DefectDetector interface — the only ML in the system
  └────────┬─────────┘
           │  Detection[] : class, surface, box, model score
           ▼
  ┌──────────────────┐
  │     evidence     │  EvidenceRecord[] in the SoftwareDNA ledger
  └────────┬─────────┘  ← THE PERSISTED ARTIFACT
           │
           ▼
  ┌──────────────────┐
  │    inference     │  claims citing evidence ids
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐
  │     verdicts     │  per subject, citing inference ids
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐
  │  PhysicalDNA     │  one score, one grade, one audit trail
  │     score        │
  └──────────────────┘
```

Everything below the detection layer is the machinery SoftwareDNA already has.
That was the test of the adapter seam, and it passed: physical inspection needed
five new vocabulary entries and no new inference machinery, no second scoring
framework, no parallel audit trail.

## The detector boundary

The interface is four lines, and it is the most important design decision here:

```ts
export interface DefectDetector {
  info(): DetectorInfo;
  detect(captures: readonly CaptureInput[]): Promise<DetectionResult>;
}
```

Everything on the far side is a neural network. Everything on this side is
explainable. DevDNA's claim is not that its model is interpretable — it is that
the model's **outputs are evidence**, and that no conclusion exists without
citing one.

Three properties follow, and each is load-bearing:

**The pipeline is buildable before the model.** A deterministic `MockDetector`
implements the same interface, which is why 47 tests cover scoring,
explainability, coverage and reproducibility today, with zero weights trained.

**The model is replaceable without touching anything else.** A new architecture,
a new vendor, an ensemble — all of it is one class implementing one interface.

**The model can never widen its own authority.** It emits detections. It cannot
emit a verdict, a score, or a confidence that reaches a report.

## Where the ML actually runs

```
 Technician's phone/tablet          DevDNA cloud                  Inference
┌────────────────────────┐        ┌──────────────────┐        ┌───────────────┐
│ guided capture UI      │  HTTPS │  NestJS API      │  gRPC  │ detector      │
│ client-side validation │ ─────► │  re-validates    │ ─────► │ (GPU, Python) │
│ (instant retake)       │        │  server-side     │ ◄───── │ Triton/TorchServe
└────────────────────────┘        └────────┬─────────┘        └───────────────┘
                                            │
                                            ▼
                                    evidence ledger → score
```

Validation runs **twice, deliberately**. Client-side so a technician learns
within a second that the shot is glared and retakes it while the device is still
in hand — a retake loop measured in minutes instead of seconds is a workflow
nobody uses. Server-side because the client is a phone in a shop and its verdict
about its own photograph cannot be the one that gates the evidence.

The identical code runs in both places: the validation functions are pure
arithmetic over a luminance plane, so decoding (canvas in the browser, `sharp`
on the server) is an adapter concern and the *judging* is shared.

## Why validation is not machine learning

Whether an image is in focus is a measurable property. Answering it with a model
would make the gate on the evidence pipeline itself unexplainable — and that gate
is what separates "no damage" from "no usable pixels". Those two look identical
in a list of zero detections, and there is no way to recover the difference
later.

So: Laplacian variance for focus, a directional sharpness ratio for motion, a
clipped-highlight ratio for glare, coarse edge density for framing. Deterministic,
storable as evidence, and re-derivable months later when a shop disputes a
rejection.

## Failures are evidence

A rejected capture is recorded, not discarded:

```
COLLECTION_FAILURE  REAR_HOUSING  ViewCaptured:BACK
  "Back rejected: EXCESSIVE_GLARE. This surface was not assessed from this image."
```

Three photographs of a rear panel defeated by bench lighting is exactly what
justifies abstaining on rear glass. A verdict that cannot show why it abstained
is indistinguishable from one that never looked.

## Repository

| Path | Contents |
|---|---|
| `packages/physical/src/taxonomy.ts` | 43 classes; the contract between annotators, model, scorer and report |
| `packages/physical/src/capture/` | The 10 views, their thresholds and surface constraints |
| `packages/physical/src/validation/` | Metrics and the gate |
| `packages/physical/src/detection/` | Detector interface, calibration, mock |
| `packages/physical/src/evidence.ts` | Detections → ledger |
| `packages/physical/src/module.ts` | Evidence → inferences → verdicts |
| `packages/physical/src/scoring.ts` | Pillars, gates, grades |
| `packages/physical/src/explain.ts`, `report.ts` | Explanations and report section |
| `ml/` | Dataset tooling, training, benchmark → calibration artifact |
