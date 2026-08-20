"""Training entry point.

Thin on purpose. The interesting decisions are in the config and in the dataset,
not here — a training script that grows logic is a training script whose results
cannot be reproduced from its config.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import yaml

from .taxonomy import load_taxonomy


def build_ultralytics_data_yaml(build_dir: Path, out: Path) -> Path:
    """Emit the data yaml from the taxonomy, never by hand."""
    taxonomy = load_taxonomy()
    payload = {
        "path": str(build_dir.resolve()),
        "train": "train/images",
        "val": "val/images",
        "test": "benchmark/images",
        "names": taxonomy.names,
    }
    out.write_text(yaml.safe_dump(payload, sort_keys=False))
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="Train the PhysicalDNA detector")
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--build", type=Path, default=Path("data/build"))
    parser.add_argument("--run-name", default=None)
    args = parser.parse_args()

    config = yaml.safe_load(args.config.read_text())
    taxonomy = load_taxonomy()

    # A run whose taxonomy differs from the dataset's is not comparable to any
    # other run, and the resulting weights would be scored against class ids
    # that mean something else.
    expected = config.get("taxonomy_version")
    if expected and expected != taxonomy.version:
        raise SystemExit(
            f"config targets taxonomy {expected}, loaded {taxonomy.version}; "
            "regenerate taxonomy.json or update the config"
        )

    raise SystemExit(
        "Not implemented: requires an annotated dataset.\n"
        f"Config parsed OK ({args.config}), taxonomy {taxonomy.version} with "
        f"{len(taxonomy.classes)} classes, {len(taxonomy.segmentation_classes)} needing masks.\n"
        "Wire to ultralytics YOLO(...).train() once data/build exists; log the run, "
        "the config, the taxonomy version and the dataset digest to MLflow so the "
        "weights can be traced to exactly the data that produced them."
    )


if __name__ == "__main__":
    main()
