# PhysicalDNA — model pipeline

Python side of PhysicalDNA: dataset tooling, training, and the benchmark that
produces the **calibration artifact** the TypeScript engine consumes.

```
annotations ──► dataset build ──► train ──► benchmark ──► calibration.json
                                                              │
                                              packages/physical loadCalibration()
```

The last arrow is the important one. This pipeline does not produce a score, a
grade, or a verdict — it produces a detector and an honest measurement of how
often that detector is right. Everything that turns detections into a number
lives in `packages/physical`, is deterministic, and is unit tested.

## The taxonomy is not defined here

`physicaldna/taxonomy.py` loads `taxonomy.json`, generated from the TypeScript
definition:

```bash
pnpm --filter @devdna/physical export:taxonomy ml/taxonomy.json
```

A label map maintained separately from the scorer's class list is the defect
neither side's tests can catch: the model learns class 17, the scorer prices
class 17 as something else, and both are internally consistent while every
number downstream is wrong. Generate it; never hand-edit it.

## Setup

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pnpm --filter @devdna/physical export:taxonomy ml/taxonomy.json
```

## Commands

```bash
python -m physicaldna.dataset  build   --manifest data/manifest.jsonl --out data/build
python -m physicaldna.dataset  audit   --build data/build
python -m physicaldna.train            --config configs/yolo11m-baseline.yaml
python -m physicaldna.evaluate --weights runs/train/best.pt --split benchmark \
                               --out artifacts/calibration.json
```

`evaluate` is the only command whose output ships. It writes per-class
precision, recall and sample size at the chosen operating threshold — the exact
shape `ClassCalibration` expects.

## Status

No model is trained and no data is collected. Every file here is structure and
contract, not a result. Nothing in this directory should be read as a
measurement until `artifacts/calibration.json` exists with real sample sizes.
