# 2. Dataset architecture, collection and annotation

The dataset is the product. The model is a compression of it, and can be
retrained in a day; the dataset takes a year and cannot be recreated.

## Required size

Sized bottom-up from the class floor rather than from a round number.

**A class needs ~300 labelled instances before it can be trained, and ~50 in the
held-out benchmark before its accuracy can be *measured*.** Below the first
number the model learns the specific devices the examples came from; below the
second, the benchmark cannot tell you that it did.

| Tier | Classes | Instances needed | Notes |
|---|---|---|---|
| Common | 12 (light/deep scratch, scuff, micro-abrasion, paint wear, dent, chip, port debris…) | 300–800 each | Abundant; the constraint is annotation time, not supply |
| Uncommon | 18 (cracks, lens damage, display defects, bends, missing components) | 300 each | Requires targeted sourcing from repair intake |
| Rare | 13 (shattered lens, liquid indicator, delamination, non-OEM screw, finish mismatch) | 150–300 each | **The hard problem.** See sourcing below |

Working totals for v1:

```
~14,000 labelled instances
~4,500 images
~1,100 devices          ← the number that actually matters
```

Images per device (~4) is not the driver. **Device count is**, because devices
are the unit of independence: ten photographs of one handset are ten highly
correlated samples, and 4,500 images of 200 devices is a far weaker dataset than
2,000 images of 900.

Target composition: ≥8 iPhone generations, ≥5 colours per generation, ≥4
collection sites, ≥3 lighting environments.

## Splitting is keyed on device, never on image

```python
def assign_split(device_id: str) -> Split:
    position = int.from_bytes(sha256(device_id).digest()[:8], "big") / 2**64
    ...
```

Splitting on images leaks, and the leak is invisible: validation mAP climbs, the
model memorises that specific handset, and the first unseen device in production
performs nothing like the benchmark promised. Hash-based rather than random so
re-running the build never reshuffles devices between splits — a benchmark set
that silently changes composition makes every cross-run comparison meaningless.

`ml/physicaldna/dataset.py` enforces this and the audit fails the build if any
device appears in two splits.

## Collection

### Sources, in order of value

| Source | Volume | Defect richness | What it costs | What it is for |
|---|---|---|---|---|
| **Repair shop intake** | High | **Highest** — devices arrive broken | Revenue share or free DevDNA seats | Rare and severe classes |
| **Refurbishment centres** | Very high | Medium — graded stock, mostly cosmetic | Commercial agreement | Volume, wear classes, grade labels |
| **Device traders / wholesale** | High | Medium-high, very diverse | Per-device fee | Generation and region diversity |
| **Internal test devices** | Low | Controlled — we can *create* defects | Device cost | Calibration targets, edge cases, taxonomy validation |

Repair intake is the unlock. A refurbisher's stock is pre-filtered toward
sellable; a repair queue is pre-filtered toward broken, which is precisely the
tail the model is worst at.

**Deliberate defect creation on internal devices** deserves its own line. Buying
40 scrap handsets and inducing controlled damage — a known drop height, a
measured scratch depth, a specific non-OEM screw — produces the only images in
the corpus with *ground truth that is not an opinion*. It is the calibration
anchor for classes where annotators otherwise disagree.

### The bargain that makes collection work

Shops do not want to be a data-labelling operation. They want the product.

> Free PhysicalDNA inspections, in exchange for the images being retained for
> model training under a signed data agreement.

The capture flow they use to get a report *is* the collection pipeline. The same
guided views, the same validator, the same storage. That means collection scales
with adoption rather than competing with it, and every image arrives already
validated and already labelled with the view it depicts.

### Capture standards

Non-negotiable per image: the view's minimum long edge (1200–1600px), passing
the production validator, a plain non-reflective background, diffuse lighting
that is not directly behind the operator, and the device at the stated framing.

Explicitly encouraged: **variety in everything else.** Different phones as
cameras, different shops, different benches, different times of day. A dataset
shot under one lighting rig produces a model that works in that rig.

### Metadata

Every image, on the record and never in the filename:

```jsonc
{
  "image_id": "img_01J...", "device_id": "dev_01J...",
  "view": "BOTTOM_EDGE",
  "sha256": "…",                    // the dataset's identity, not its path
  "storage_key": "s3://devdna-physical/raw/2026/08/…",
  "width": 4032, "height": 3024,
  "captured_at": "2026-08-19T10:04:12Z",
  "capture_source": "shop:northbridge-repair",
  "device_model": "iPhone14,3",
  "validation_passed": true,
  "annotations": [ … ]
}
```

`device_id` is a salted hash of the handset's UDID, never the UDID — the same
per-tenant discipline SoftwareDNA already applies. It is enough to group images
by device for splitting, and not enough to identify the handset or its owner.

### Storage

```
s3://devdna-physical/
  raw/<yyyy>/<mm>/<sha256>.jpg          immutable, content-addressed, versioned
  derived/<taxonomy-version>/<split>/   generated, disposable, rebuildable
  manifests/<dataset-version>.jsonl     the dataset IS this file
  annotations/<batch>/<annotator>.jsonl append-only
```

Content addressing means the same photograph uploaded twice is one object, and a
manifest pins exactly which bytes a model saw. `derived/` is disposable by
design: anything that cannot be rebuilt from `raw/` + a manifest is not part of
the dataset.

## Annotation

### Platform

CVAT (self-hosted) for v1. Open source, supports box + polygon + mask in one
project, has a real review workflow, and imports/exports COCO. Label definitions
are **imported from `taxonomy.json`**, generated from the TypeScript taxonomy —
never typed into the tool by hand.

### Who annotates

Two tiers, and the split matters. **Cosmetic classes** (scratches, scuffs, wear,
paint) go to trained generalist annotators. **Provenance and functional classes**
(non-OEM screw, pry mark, panel gap, delamination, liquid indicator) go to
technicians, because they require knowing what a factory-seated panel looks
like. An annotator who has never opened an iPhone cannot reliably label a pry
mark, and asking them to produces labels that are worse than no labels.

### The rules are in the taxonomy

Every class carries its own `annotationRule` and, where a confusion pair exists,
`notToBeConfusedWith`. These are not documentation — they are the fields the
annotation tool renders in its guide panel:

```
SCRATCH_DEEP
  Rule:  A linear mark visible under diffuse light without tilting the device,
         showing displaced material or a white/bright core.
  Not:   CRACK_HAIRLINE, which propagates and has no width.
```

The confusion pairs were written from the pairs that actually confuse people:
scratch vs hairline crack, pry mark vs drop damage, finish mismatch vs a
lighting gradient, display discolouration vs camera white balance.

### Quality control

1. **Gold set.** 200 images labelled by consensus of three technicians. Every
   annotator passes it before doing production work, and it is re-injected at
   ~3% of their queue, unannounced, forever.
2. **Double annotation on 15%,** stratified toward rare and provenance classes.
3. **Inter-annotator agreement is a first-class metric**, tracked per class.
   It is the ceiling on achievable model accuracy — a class humans agree on 70%
   of the time cannot be learned to 90%, and pushing on the model is wasted
   effort. **Agreement below 0.6 IoU / 0.75 class-F1 triggers a taxonomy review,
   not more training data.** The class definition is the problem.
4. **Adjudication** by a senior technician on disagreement; the resolution is
   appended to the class's annotation rule so the same disagreement does not
   recur.
5. **`UNCLASSIFIED_ANOMALY` is queued, never trained.** Every instance is
   reviewed. A cluster of them is the signal the taxonomy needs a new class —
   which is exactly why the class exists rather than forcing an annotator to
   pick the nearest wrong label.

## Versioning

Three versioned artifacts, related but distinct:

| Artifact | Version | Changes when |
|---|---|---|
| Taxonomy | `TAXONOMY_VERSION` in code | A class is added, removed, or its definition changes |
| Dataset | `manifests/<dataset-version>.jsonl` | Any image or annotation is added or corrected |
| Calibration | `benchmarkVersion` in the artifact | A benchmark run publishes new numbers |

A taxonomy change **invalidates every calibration measured under the old one**,
because a class whose definition moved is not the class that was measured. The
engine enforces the link: the taxonomy version is stamped onto every evidence
record's `instrument` field.

Datasets are append-only. A wrong annotation is corrected by appending a
correction, never by mutating history, so any past model remains explainable by
the data that produced it.

## Governance

- **Consent is contractual, per site.** No image enters the corpus without a
  signed data agreement covering training use and retention.
- **No personal data by construction.** Photographs are of a device exterior.
  Screens are captured showing a test pattern, never a home screen or lock
  screen — which would carry wallpapers, notifications, and names.
- **Serial numbers and IMEIs are blurred at ingest** where an edge or SIM-tray
  capture catches them, before the image is written to `raw/`.
- **Deletion.** A site withdrawing consent has its images removed from `raw/`
  and its `capture_source` purged from manifests; the next dataset version is
  rebuilt without them. Models trained on withdrawn data are retired on the
  next release rather than retroactively unpublished — and that limitation is
  stated in the agreement rather than discovered later.
- **Access.** `raw/` is readable by the ML team and no one else. No image is
  ever returned by a customer-facing API.
