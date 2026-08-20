# 4. Model comparison

## What the model is actually asked to do

Before comparing anything, the requirement, because it eliminates most of the
field immediately:

1. **Localise** 43 classes — a report must say *where*, and the score needs
   extent.
2. **Segment** 21 of them. Cracks, wear fields and burn-in have no meaningful
   bounding box; a box around a diagonal hairline crack overstates its area by
   ~10×, and that error feeds directly into the score.
3. **Find small, low-contrast objects.** A hairline crack is a few pixels wide
   with near-zero contrast against reflective glass. This is the hard part, and
   it is what actually separates the candidates.
4. **Run in under ~2s for 8–10 images**, so a technician is not waiting.
5. **Be calibratable per class**, because reliability must be measured per class.
6. **Deploy on hardware we control**, so cost per inspection is predictable.

Requirement 2 removes every pure classifier. Requirement 3 sets the resolution
floor. Requirement 6 removes hosted-API-only options.

## Candidates

| Architecture | Task fit | Small-object accuracy | Speed (1280px, A10G) | Deployment | Verdict |
|---|---|---|---|---|---|
| **YOLO11-seg (m)** | Detection **+ instance segmentation** | Strong; P2 head available | ~35–45ms | Trivial — ONNX/TensorRT, one file | **Chosen** |
| YOLO11 (detect only) | Boxes only | Strong | ~25ms | Trivial | Fails requirement 2 |
| RT-DETR (R50) | Detection only | Good; better on occlusion | ~60–80ms | Moderate | No seg head; NMS-free advantage doesn't pay here |
| Detectron2 (Mask R-CNN) | Detection + seg | **Best mask quality** | ~180–250ms | Heavy — Detectron2 pins, slow export | Strong candidate; see below |
| Grounding DINO | Open-vocabulary detection | Weak on fine damage | ~400ms+ | Heavy | Wrong tool; see below |
| EfficientNet / ConvNeXt | Whole-image classification | N/A — no localisation | ~10ms | Trivial | Fails 1 and 2 |
| ViT (DINOv2 backbone) | Feature extraction | Excellent features | Backbone only | Moderate | Useful *inside* a detector, not as one |
| CLIP-based | Zero-shot classification | Poor on fine-grained damage | ~20ms | Trivial | See below |

### Why not Grounding DINO or CLIP

Both are genuinely attractive for a cold start: describe the defect in text, get
detections, no annotation. Both fail for the same reason.

They are trained on web image–caption pairs, where "cracked screen" means an
obviously shattered phone. They have essentially no notion of a 3mm hairline
fracture, a pry mark, or a non-OEM screw head — the classes that carry DevDNA's
commercial value. Measured zero-shot performance on fine-grained industrial
defect benchmarks is far below what a small supervised model reaches with a few
hundred examples per class.

There is a second, worse problem: **they are not calibratable in the way this
architecture requires.** A prompt-conditioned score has no stable relationship
to precision across prompts, so the number that becomes evidence reliability
cannot be measured once and trusted.

They do have a real role — **pre-annotation**. Grounding DINO with prompts like
"crack on glass" produces candidate boxes an annotator corrects rather than
draws, and that is a meaningful speed-up on the common classes in Phase 2.

### Why not Detectron2, despite better masks

Mask R-CNN produces the best masks of the candidates and would measurably improve
extent estimation on cracks and wear fields. It loses on everything else: 5–7×
the latency, a much heavier deployment story, and slow, brittle export paths.

The honest position: **if extent estimation turns out to be the accuracy
bottleneck after Phase 3, Detectron2 is the escalation.** The detector interface
makes that a one-class change. It is not the starting point, because it costs a
lot of operational complexity to solve a problem we have not yet demonstrated we
have.

### Why not RT-DETR

RT-DETR's NMS-free design is a genuine advantage where objects overlap heavily.
Defects on a phone surface mostly do not overlap. It brings no segmentation head,
which is the disqualifier, and pays latency for a benefit this domain does not
collect.

## Recommendation: YOLO11m-seg at 1280px

```yaml
arch: yolo11m-seg
imgsz: 1280
```

**Segmentation, not detection**, for the 21 mask/polygon classes and the extent
accuracy the scorer depends on.

**1280px, not 640.** The single most consequential hyperparameter here. At 640 a
hairline crack on a 4032px capture is sub-pixel and simply does not exist in the
input. Doubling resolution costs ~4× compute and is the difference between
detecting the class and not.

**`m`, not `n`/`s`/`l`/`x`.** At 1280px the medium model already meets the
latency budget with room to spare; the larger variants buy accuracy the dataset
is nowhere near large enough to support. Revisit at 50k+ instances.

**Ultralytics rather than a from-scratch implementation** for v1: mature export
to ONNX/TensorRT, built-in augmentation and metrics, and one dependency instead
of a research stack. Note the licence — AGPL-3.0 for the framework, requiring
either a commercial licence from Ultralytics or a migration to a permissively
licensed implementation before shipping. **That is a decision to make in Phase 3,
not to discover in Phase 5.**

## Per-surface specialists, not one model

Detection runs **per view**, and each view is constrained to the surfaces it can
physically show. A rear-glass detection in the front-view image is rejected by
the evidence adapter — the guard is tested, and it exists because a
misattributed defect prices a device on damage that was never photographed.

The v1 model is a single set of weights over all classes; the *routing* is what
is per-surface. If class confusion between surfaces proves to be a real error
mode after Phase 3, splitting into a display model and a body model is
straightforward and the interface does not change.

## What gets measured, not assumed

Every number in the table above is a published benchmark on generic datasets
(COCO, and industrial-defect literature). **None of them is a measurement of
performance on iPhone damage**, because that dataset does not exist yet.

The architecture choice is therefore a *starting hypothesis*, and Phase 3's exit
criterion is a head-to-head on DevDNA's own benchmark split — YOLO11m-seg against
at minimum Mask R-CNN — with the decision recorded and the losing configuration
kept reproducible.
