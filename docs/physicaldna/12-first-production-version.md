# 12. Recommended first production version

## The recommendation

Ship **PhysicalDNA v1 as a disclosed-partial capability**, not as a complete
grading system, and ship it the moment Phase 3's calibration lands rather than
waiting for all 43 classes.

Specifically:

| | v1 |
|---|---|
| Model | YOLO11m-seg @ 1280px, single set of weights |
| Classes live | The ~20–30 that meet precision ≥0.90 with ≥50 benchmark instances |
| Classes present but uncalibrated | The rest — detected, recorded as evidence, low reliability, visible in coverage |
| Views | All 10, with the display test-pattern flow deferred if Phase 4 slips |
| Trust integration | **Off.** Repair indicators identified and exposed, not yet wired into Service Evidence |
| Grade | Issued only when confidence ≥0.45; capped by coverage as always |
| Positioning | *"Automated physical condition assessment, with stated coverage"* — never *"complete damage detection"* |

## Why partial, and why that is the strong move

The instinct is to wait until every class works. That is wrong for three
reasons.

**The architecture already handles partial capability honestly.** An uncalibrated
class contributes low reliability and reduced coverage. The report states what
was assessed and what was not. A device inspected with 25 live classes gets a
defensible grade with an honest confidence — not a wrong one.

**Partial capability generates the data that completes it.** Every production
inspection is a labelled candidate, and every technician correction is free
ground truth for exactly the classes that are failing. Waiting for completeness
means waiting without the data flow that produces it.

**The alternative fails commercially.** A system that refuses to grade until it
is perfect never ships, and a system that claims completeness it does not have
gets caught by the first cracked "PRISTINE" handset — which would cost
credibility on the SoftwareDNA numbers too, and those are measured.

## What must be true before v1 ships

Non-negotiable, all mechanical:

1. Every live class has ≥50 benchmark instances and ≥0.90 measured precision.
2. False positive rate on the clean-device set is <2% of devices.
3. Model agreement with technician consensus ≥ median technician agreement.
4. The calibration artifact is attached in the model registry.
5. Zero provenance violations across the benchmark corpus.
6. Reports print coverage and the not-assessed list with equal prominence to the
   score.
7. The Ultralytics licensing decision is made and documented.

## What v1 deliberately does not do

**No trust integration.** Repair indicators are the most valuable thing
PhysicalDNA will eventually contribute — physical evidence that contradicts a
device's own account of itself. They are held back because a false-positive
non-OEM screw would move a *trust* verdict, and a wrong trust verdict is
categorically worse than a wrong condition grade. They ship in Phase 4 at a
higher precision bar (≥0.93) than everything else.

**No automatic pricing.** The score is an input to a pricing decision, not the
decision. Publishing a price implies a warranty of the assessment that the
measured accuracy does not yet support.

**No per-generation models.** One set of weights. Per-generation mAP will show
whether that holds, and splitting is a data change rather than an architecture
change.

**No claim to replace inspection.** v1 makes a technician's inspection
repeatable, comparable and disclosable. That is a large and sufficient claim.

## The state today, precisely

The engine is complete and runs end to end. Given ten validated captures of a
clean device it produces:

```
Overall Condition:      No grade issued
PhysicalDNA Score:      — (insufficient evidence)
Inspection Confidence:  38%
Device Coverage:        100%

Limits on this assessment:
  - The defect detector has no measured precision or recall on a held-out
    benchmark, so the absence of a detection cannot yet support a top grade.
```

100% coverage, zero provenance violations, and no grade — because the model does
not exist yet. Load a benchmarked calibration and the identical input scores in
the nineties, with the cap lifted. Both behaviours are asserted by test.

That is the whole design in one output: **the system knows what it does not
know, and says so, before anyone asks it to.**
