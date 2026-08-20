# 11. Risks and limitations

Read this before making any commercial promise about PhysicalDNA.

## The hard limits

### 1. A photograph cannot see inside the device

PhysicalDNA assesses the **exterior**. It cannot see a swollen battery until the
frame separates, water damage that left no visible corrosion, a bent logic board,
or a display fault that only appears warm.

**Mitigation.** SoftwareDNA covers most of the interior story from the device's
own registries, and the combined report is the product. But the boundary must be
stated: *"no visible damage"* is not *"no damage"*, and the report says visible.

**Never claim.** That PhysicalDNA assesses functional condition. It assesses
visible physical condition, which correlates with function and does not
determine it.

### 2. Inter-annotator agreement caps achievable accuracy

If three technicians agree on a class 70% of the time, no model will exceed ~70%
on it. This is not a training problem and cannot be fixed with more data.

**Impact.** The subtle provenance classes — pry mark, finish mismatch, panel gap
— are exactly the commercially valuable ones *and* the ones humans disagree on.

**Mitigation.** Agreement is measured per class and treated as the ceiling.
Classes below the floor are redefined or removed in Phase 2 rather than trained
harder. `UNCLASSIFIED_ANOMALY` catches what the taxonomy cannot yet name.

### 3. Uncontrolled capture conditions

A technician's phone, a shop's lighting, a scratched bench. Glass is specular:
under a ceiling LED, a blown-out band across the panel is the norm, and every
defect beneath it is invisible.

**Impact.** This is the largest source of false negatives, and it is
systematic — the same shop produces the same blind spot on every device it
inspects.

**Mitigation.** The validation gate rejects glare above 6% clipping; rejections
are recorded as evidence so the abstention is visible; per-site fleet metrics
surface a shop whose capture quality is degrading. **Not solved**, and the
honest framing is that DevDNA measures what it could see and says how much that
was.

### 4. Rare classes may never reach production accuracy

A triggered liquid indicator, a shattered lens, delamination. Some are rare
enough that gathering 300 labelled instances plus 50 held-out could take years of
organic collection.

**Mitigation.** Deliberate defect creation on scrap devices; targeted purchasing;
repair-shop intake weighting. And the architecture handles the failure gracefully:
an uncalibrated class contributes low reliability and reduced coverage rather
than a confident wrong answer.

**Never do.** Ship a class at production confidence on a thin benchmark. The
`sampleSize >= 50` check is in code, and a test asserts a five-sample benchmark
claiming 99% precision is still treated as unmeasured.

### 5. Adversarial capture

A seller who knows the system photographs the good side, angles the light to hide
a scratch field, or retakes until the crack falls outside the frame.

**Impact.** Real, and it grows with adoption. The incentive is precisely aligned
against us: the person operating the camera often profits from a higher grade.

**Mitigation.** Required views with framing constraints; coverage caps so a
partial inspection cannot reach a top grade; recording every rejected capture, so
"nine attempts at the rear panel" is itself visible. Longer term: capture-session
integrity — timestamps, ordering, device-side attestation — and cross-checking
detected damage against the same device's previous inspections.

**Honest framing.** This is deterrence and disclosure, not prevention. A
determined adversary with control of the camera can degrade what PhysicalDNA
sees. The system's defence is that it *reports how much it saw*, so a suspiciously
narrow inspection looks narrow rather than clean.

## Commercial and product risks

| Risk | Likelihood | Impact | Response |
|---|---|---|---|
| **Data collection is slower than planned** | **High** | **High** | It is the critical path. Start Phase 1 first, buy defect devices, treat free inspections as the collection channel |
| Annotation cost exceeds budget | High | Medium | Pre-annotation with Grounding DINO; two annotator tiers so technician time goes only where it is needed |
| Severity weights are miscalibrated against trade pricing | **High** | **High** | Built from first principles, not from data. Validate against partner shops' actual price adjustments in Phase 4; they are one table and one version bump to change |
| A shop disputes a grade | High | Medium | Every finding cites its evidence; rejections carry their measurements; assessments are reproducible from stored evidence |
| Ultralytics AGPL licence | Medium | High | Decide in Phase 3, not Phase 5. Either buy the commercial licence or port to a permissive implementation |
| Model overfits to partner shops' lighting | Medium | High | Per-site mAP is a tracked metric; ≥4 sites and ≥3 lighting environments are exit criteria |
| A "PRISTINE" device with an obvious crack | Low | **Existential** | The `DETECTOR_UNCALIBRATED` cap; per-class precision floors; the clean-device false-positive set. One of these in public costs credibility on the SoftwareDNA numbers too |

## Known implementation gaps

| Gap | Status |
|---|---|
| No trained detector | By design — Phase 3. The engine correctly declines to grade |
| Calibration table is placeholders | Marked `sampleSize: 0`, `benchmarkVersion: unmeasured-0`; the engine treats every class as uncalibrated |
| `ml/train.py` and `ml/evaluate.py` exit with "not implemented" | Contracts and configs are fixed and the taxonomy loader is verified; the bodies need data |
| Repair indicators not yet wired into Service Evidence | Deliberate — held until those classes have measured precision, because a false positive would move a *trust* verdict |
| Subject framing is a heuristic | Coarse edge density. Gates only the two failures it can establish; never claims framing is correct |
| No guided capture UI | Phase 1. The validation layer it needs is built and tested |
| Client-side validation not implemented | Pure functions are ready; needs a canvas decode adapter |
| Display defect classes untestable without test patterns | Capture flow is Phase 4 |
| No per-generation model variation | Single model for all iPhones; per-generation mAP will show whether that holds |

## What PhysicalDNA must never claim

1. **That it detects all damage.** It reports what it detected and how much of
   the device it assessed. Coverage is on every report for this reason.
2. **That a high score means undamaged.** It means no damage was detected on the
   surfaces that were usably photographed, at the stated confidence.
3. **That a detection is certain because the model was confident.** Reports print
   calibrated reliability, never the model's score.
4. **That it replaces a technician's inspection.** It makes one repeatable,
   comparable and disclosable across parties who do not trust each other.
5. **That the absence of a finding is evidence of soundness.** The founding rule
   of the whole architecture, and it applies to photographs exactly as it applies
   to service records.
