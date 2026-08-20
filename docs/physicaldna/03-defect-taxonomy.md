# 3. Defect taxonomy

43 classes across 9 groups. Defined once in
`packages/physical/src/taxonomy.ts`; everything else — annotation tool labels,
model class map, scorer, report copy — is generated from it.

A label map maintained separately from the scorer's class list is the defect
neither side's tests can catch. The model learns class 17, the scorer prices
class 17 as something else, both are internally consistent, and every number
downstream is quietly wrong. Generate it; never hand-edit it.

```bash
pnpm --filter @devdna/physical export:taxonomy ml/taxonomy.json
```

## The tree

```
SURFACE_DAMAGE
 ├─ SCRATCH_LIGHT          cosmetic    box       0.06
 ├─ SCRATCH_DEEP           cosmetic    box       0.18
 ├─ SCUFF                  cosmetic    polygon   0.08
 ├─ CRACK_HAIRLINE         functional  polygon   0.55
 ├─ CRACK_STRUCTURAL       functional  polygon   0.80
 ├─ SHATTERED_GLASS        functional  mask      0.95
 ├─ CHIP                   functional  box       0.35
 └─ GOUGE                  functional  box       0.30

FRAME_DAMAGE
 ├─ DENT                   functional  box       0.32
 ├─ BENT_FRAME             functional  polygon   0.75
 ├─ PAINT_WEAR             cosmetic    polygon   0.10
 ├─ ANODISING_LOSS         cosmetic    polygon   0.12
 └─ EDGE_SEPARATION        functional  box       0.60  ← trust-relevant

CAMERA_DAMAGE
 ├─ LENS_SCRATCH           functional  box       0.40
 ├─ LENS_CRACK             functional  polygon   0.70
 ├─ LENS_SHATTERED         functional  mask      0.90
 ├─ CAMERA_MODULE_MISALIGNMENT  provenance box  0.45  ← trust-relevant
 ├─ CAMERA_INTERNAL_DEBRIS      functional box  0.50  ← trust-relevant
 └─ LENS_COATING_DAMAGE    functional  polygon   0.25

DISPLAY_DEFECT                                        (require display-on views)
 ├─ DISPLAY_DEAD_PIXELS    functional  box       0.40
 ├─ DISPLAY_LINE_DEFECT    functional  box       0.70
 ├─ DISPLAY_BURN_IN        functional  mask      0.45
 ├─ DISPLAY_BACKLIGHT_BLEED functional mask      0.30
 ├─ DISPLAY_DISCOLOURATION functional  mask      0.35
 ├─ DISPLAY_PRESSURE_MARK  functional  box       0.40
 └─ DISPLAY_DELAMINATION   functional  polygon   0.55  ← trust-relevant

WEAR                                                  (body-wear pillar only)
 ├─ MICRO_ABRASION_FIELD   cosmetic    mask      0.12
 ├─ HEAVY_WEAR_FIELD       cosmetic    mask      0.30
 └─ BODY_DISCOLOURATION    cosmetic    mask      0.20

MISSING_COMPONENT
 ├─ MISSING_SCREW          provenance  box       0.35  ← trust-relevant
 ├─ MISSING_SIM_TRAY       functional  box       0.30
 ├─ MISSING_LENS_RING      provenance  box       0.40  ← trust-relevant
 └─ MISSING_BUTTON         functional  box       0.50

REPAIR_INDICATOR                                      (all trust-relevant)
 ├─ NON_OEM_SCREW          provenance  box       0.15
 ├─ ADHESIVE_RESIDUE       provenance  polygon   0.15
 ├─ PRY_MARK               provenance  box       0.20
 ├─ PANEL_GAP              provenance  polygon   0.25
 ├─ FINISH_MISMATCH        provenance  polygon   0.25
 └─ AFTERMARKET_MARKING    provenance  box       0.20

CONTAMINATION
 ├─ CORROSION              functional  polygon   0.60  ← trust-relevant
 ├─ PORT_DEBRIS            cosmetic    box       0.10
 └─ LIQUID_INDICATOR_TRIGGERED provenance box   0.50  ← trust-relevant

ANOMALY
 └─ UNCLASSIFIED_ANOMALY   functional  box       0.20  (human-only, never predicted)
```

Columns: nature · annotation geometry · severity weight.

## Three axes, deliberately separate

Each class carries all three, because collapsing any pair produces a system that
grades badly.

### Nature: cosmetic, functional, provenance

Not the same as severity. A hairline crack is small and **functional**; heavy
edge wear is large and **cosmetic**. Grading systems that conflate the two end up
pricing a scuffed-but-sound handset below a pristine-looking cracked one.

**Provenance** is the third and it is the one that touches trust. See below.

### Severity weight

How much a single maximal instance damages its surface, 0..1. Calibrated against
**trade pricing, not against how alarming it looks**. Shattered rear glass is
0.95 because it costs most of the panel's value; a light scratch is 0.06 because
the trade barely prices it.

### Annotation geometry

21 of 43 classes are POLYGON or MASK, and that determines the model architecture:
a box around a diagonal hairline crack overstates its area by roughly an order of
magnitude, which feeds straight into the extent factor and therefore into the
score. This is why the baseline is a segmentation model, not a detector.

## `trustRelevant` — the only route from a photograph to the trust score

13 classes are marked `trustRelevant`. They are evidence the device has been
**opened or altered**: non-OEM screws, pry marks, adhesive residue, panel gaps,
finish mismatch, internal camera debris, a triggered liquid indicator.

Everything else — every scratch, every dent, every worn edge — is marked *not*
trust-relevant, and that is asserted by test:

```ts
expect(ids).toContain('NON_OEM_SCREW');
expect(ids).not.toContain('SCRATCH_LIGHT');
```

**A scratched phone is not a less trustworthy phone.** A system that lets
cosmetic condition move the trust score produces a number that means neither
condition nor trust. The trust integration is described in
[08-integration.md](08-integration.md).

## `UNCLASSIFIED_ANOMALY`

Applied by human reviewers only, never predicted at production confidence.

It exists so unknown damage is *recorded* rather than discarded or forced into
the nearest wrong label. Every instance is queued for taxonomy review, and a
cluster of them is the signal that the taxonomy needs a new class. Without it,
the pressure on an annotator facing something unfamiliar is to pick something —
and that is how a taxonomy silently rots.

## Evolution

Class ids are **never renamed**. A rename is a new class plus a deprecation of
the old one, because a renamed class silently invalidates every annotation,
model and calibration that referenced it while appearing to be a cosmetic change.

Changing a class *definition* bumps `TAXONOMY_VERSION` and invalidates every
calibration measured under the old one — a class whose definition moved is not
the class that was measured. The engine enforces the link by stamping the
taxonomy version onto every evidence record's `instrument` field.
