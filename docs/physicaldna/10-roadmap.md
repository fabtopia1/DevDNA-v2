# 10. Roadmap

Phase 0 is complete. Every subsequent phase has deliverables, success metrics and
a hard exit criterion.

## Phase 0 — Engine before model ✅ complete

**Deliverables.** Taxonomy (43 classes), capture plan (10 views), validation
layer, detector interface, calibration model, evidence adapter, condition module,
scoring engine, explainability, report section, 47 tests, ML pipeline structure,
this blueprint.

**Why this order.** Building the engine first means the dataset is collected
against a taxonomy that already has to satisfy a scorer, a report and a set of
tests — rather than discovering after 10,000 annotations that two classes are
indistinguishable in practice or that a class nothing prices was expensive to
label.

**Exit criteria — all met.** Pipeline runs end to end on a mock detector; zero
provenance violations on every path; assessment reproducible from stored evidence
alone; engine declines to grade while uncalibrated; grades correctly once
calibration is loaded.

---

## Phase 1 — Data collection (weeks 1–14)

**Deliverables**
- Signed data agreements with ≥4 sites: ≥2 repair shops, ≥1 refurbisher, ≥1 trader
- Guided capture web app (the production UI, used for collection from day one)
- Ingest pipeline: validation, identifier blurring, content-addressed storage
- 40 internal scrap devices with deliberately induced, catalogued defects
- Dataset manifest v0.1

**Success metrics**
- ≥1,100 devices, ≥4,500 validated images
- ≥8 iPhone generations, ≥4 sites, ≥3 lighting environments
- Validation pass rate ≥70% at capture (below that, the instructions are wrong)
- Every rare class represented on ≥30 distinct devices

**Exit criteria**
- Every class has ≥150 candidate instances identified (not yet annotated)
- No class is present on fewer than 20 devices
- Ingest runs unattended for two weeks with no manual intervention

**The risk to watch.** Rare classes will lag. Have a standing purchase budget for
scrap devices with specific defects — buying a corroded charge port is far
cheaper than waiting six months for one to arrive.

---

## Phase 2 — Annotation platform (weeks 8–22, overlapping Phase 1)

**Deliverables**
- CVAT deployed, labels imported from generated `taxonomy.json`
- Annotation guide rendering each class's rule and confusion pairs
- 200-image gold set, consensus-labelled by three technicians
- Two annotator tiers trained: generalist (cosmetic) and technician (provenance)
- Grounding DINO pre-annotation for common classes
- Double annotation on 15%, adjudication workflow, agreement dashboard

**Success metrics**
- ≥14,000 labelled instances
- Inter-annotator agreement ≥0.6 IoU and ≥0.75 class-F1 on every class
- Gold-set pass rate ≥90% per annotator
- Pre-annotation cuts time-per-image on common classes by ≥40%

**Exit criteria**
- Dataset audit passes: no device in two splits, no unknown class, no unvalidated
  image, ≥300 instances in ≥30 classes
- **Any class below the agreement floor has been redefined or removed.** This is
  the gate that stops a bad class from consuming the whole project — if humans
  cannot agree on it, no amount of training data will fix it.

---

## Phase 3 — Baseline model (weeks 20–30)

**Deliverables**
- YOLO11m-seg trained at 1280px; MLflow tracking; registry with staging
- Head-to-head against Mask R-CNN on DevDNA's own benchmark split
- First calibration artifact with real sample sizes
- Inference service behind the `DefectDetector` interface
- Ultralytics licensing decision made and documented

**Success metrics**
- ≥20 classes meeting production precision (≥0.90) with ≥50 benchmark instances
- Per-surface mAP: no surface below 50% of the best
- p95 latency < 2s per 10-image session

**Exit criteria**
- `loadCalibration()` with real numbers produces sensible grades on a held-out
  set of devices graded independently by technicians
- The `DETECTOR_UNCALIBRATED` gate lifts for the calibrated classes
- Architecture decision recorded, with the losing configuration reproducible

---

## Phase 4 — Advanced defect detection (weeks 28–44)

**Deliverables**
- Display defect capture: test-pattern flow (white/black/grey fields)
- Provenance class push: non-OEM screw, pry mark, panel gap, finish mismatch
- **Repair indicators wired into the Service Evidence Engine** — the trust
  integration, deliberately held until these classes have measured precision
- Per-surface model routing if cross-surface confusion proves real
- Active learning: uncertain and low-confidence cases routed back to annotation

**Success metrics**
- ≥30 of 43 classes calibrated, including **every** `trustRelevant` class at
  precision ≥0.93 — higher than the general bar, because these move trust
- Display defect classes at precision ≥0.90 on the test-pattern captures
- Model agreement with technician consensus ≥ median technician agreement

**Exit criteria**
- All ten production readiness criteria met ([09-testing.md](09-testing.md))
- A physical repair indicator successfully contradicts a device's own service
  history on a known-serviced handset, end to end

---

## Phase 5 — Production deployment (weeks 40–52)

**Deliverables**
- Guided capture in the technician app, with instant client-side retake feedback
- PhysicalDNA section on reports and the public verification page
- Combined SoftwareDNA + PhysicalDNA report
- Technician review UI: accept, reject or add a finding, with the correction fed
  back to the dataset
- Fleet drift monitoring dashboard
- Staged rollout: internal → 2 design partners → general availability

**Success metrics**
- ≥80% of inspections complete guided capture without abandoning
- Technician override rate <15%
- Grade distribution within 1 band of partner shops' own grading on ≥85% of devices
- Zero provenance violations in production

**Exit criteria**
- 30 days at general availability with no rollback
- A dispute resolved using a stored assessment, reproduced from evidence alone

---

## Phase 6 — Continuous learning (ongoing from week 48)

**Deliverables**
- Technician corrections flowing into the dataset as labelled data
- Monthly retraining triggered by volume or drift
- Automated calibration refresh per release
- Taxonomy review board: `UNCLASSIFIED_ANOMALY` clusters become new classes
- Per-generation model refresh as new iPhones ship

**Success metrics**
- Override rate trending down quarter on quarter
- New iPhone generation supported within 60 days of release
- Every calibration refresh improves or holds precision on every class — a
  regression on any single class blocks the release

**Exit criteria.** None. This phase does not end; it is the mechanism by which
the model becomes an industry standard rather than a launch.

---

## Critical path

```
Phase 1 collection ─────────────┐
        └─► Phase 2 annotation ─┴─► Phase 3 baseline ─► Phase 4 advanced ─► Phase 5 production
                                                                                    └─► Phase 6
```

**Data collection is the critical path and everything else has slack.** The
model, the MLOps and the UI can all be compressed; a year of device throughput
cannot. Start Phase 1 before anything else is finalised — the engine it feeds
already exists and will not change under it.
