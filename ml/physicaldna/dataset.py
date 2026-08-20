"""Dataset schema, build and audit.

Two ideas drive this module.

**The device, not the image, is the unit of splitting.** Ten photographs of one
handset are ten highly correlated samples. Splitting them across train and
validation leaks, and the leak is invisible: validation mAP climbs, the model
memorises that specific device, and the first unseen handset in production
performs nothing like the benchmark said it would. Splits are therefore keyed on
``device_id``, never on image.

**Every annotation carries who made it and when.** Annotator identity is what
lets disagreement be measured, and inter-annotator agreement is the ceiling on
achievable model accuracy — a class humans label consistently 70% of the time
cannot be learned to 90%.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Iterator, Literal

from pydantic import BaseModel, Field, field_validator

from .taxonomy import load_taxonomy

Split = Literal["train", "val", "benchmark"]


class BoundingBox(BaseModel):
    """Normalised to 0..1 so it survives any resize."""

    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)


class Annotation(BaseModel):
    annotation_id: str
    class_id: str
    box: BoundingBox
    polygon: list[tuple[float, float]] | None = None
    annotator_id: str
    annotated_at: str
    #: Set when a second annotator reviewed this instance.
    reviewed_by: str | None = None
    #: Free-text note; required when class_id is UNCLASSIFIED_ANOMALY.
    note: str | None = None


class ImageRecord(BaseModel):
    image_id: str
    device_id: str
    view: str
    #: Content hash of the original file. The dataset's identity, not its path.
    sha256: str
    storage_key: str
    width: int
    height: int
    captured_at: str
    capture_source: str
    device_model: str | None = None
    #: Present once the image has passed the same validator production uses.
    validation_passed: bool = True
    annotations: list[Annotation] = Field(default_factory=list)

    @field_validator("annotations")
    @classmethod
    def _known_classes(cls, value: list[Annotation]) -> list[Annotation]:
        names = {entry.id for entry in load_taxonomy().classes}
        for annotation in value:
            if annotation.class_id not in names:
                raise ValueError(f"unknown class {annotation.class_id}")
        return value


def read_manifest(path: Path) -> Iterator[ImageRecord]:
    with path.open() as handle:
        for line in handle:
            line = line.strip()
            if line:
                yield ImageRecord.model_validate_json(line)


def assign_split(device_id: str, ratios: tuple[float, float, float] = (0.7, 0.15, 0.15)) -> Split:
    """Deterministic, device-keyed split.

    Hash-based rather than random so that re-running the build never reshuffles
    devices between splits — a benchmark set that silently changes composition
    between runs makes every comparison across runs meaningless.
    """
    digest = hashlib.sha256(device_id.encode()).digest()
    position = int.from_bytes(digest[:8], "big") / 2**64
    train, val, _ = ratios
    if position < train:
        return "train"
    if position < train + val:
        return "val"
    return "benchmark"


class AuditReport(BaseModel):
    images: int
    devices: int
    per_split: dict[str, int]
    per_class: dict[str, int]
    classes_below_floor: list[str]
    devices_in_multiple_splits: list[str]
    unvalidated_images: int
    unreviewed_anomalies: int

    @property
    def ok(self) -> bool:
        return (
            not self.classes_below_floor
            and not self.devices_in_multiple_splits
            and self.unvalidated_images == 0
        )


#: Minimum labelled instances before a class may be trained at all.
#:
#: Below this the model learns the handful of devices the examples came from
#: rather than the defect, and — worse — the held-out set is too small to
#: measure the failure. A class under the floor is excluded from training and
#: reported as uncovered, which is honest; shipping it and hoping is not.
CLASS_INSTANCE_FLOOR = 300


def audit(records: list[ImageRecord]) -> AuditReport:
    per_split: Counter[str] = Counter()
    per_class: Counter[str] = Counter()
    device_splits: defaultdict[str, set[str]] = defaultdict(set)
    unvalidated = 0
    unreviewed_anomalies = 0

    for record in records:
        split = assign_split(record.device_id)
        per_split[split] += 1
        device_splits[record.device_id].add(split)
        if not record.validation_passed:
            unvalidated += 1
        for annotation in record.annotations:
            per_class[annotation.class_id] += 1
            if annotation.class_id == "UNCLASSIFIED_ANOMALY" and not annotation.reviewed_by:
                unreviewed_anomalies += 1

    taxonomy = load_taxonomy()
    below = [
        entry.id
        for entry in taxonomy.classes
        if per_class[entry.id] < CLASS_INSTANCE_FLOOR
    ]

    return AuditReport(
        images=len(records),
        devices=len(device_splits),
        per_split=dict(per_split),
        per_class=dict(per_class),
        classes_below_floor=below,
        devices_in_multiple_splits=[d for d, s in device_splits.items() if len(s) > 1],
        unvalidated_images=unvalidated,
        unreviewed_anomalies=unreviewed_anomalies,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="PhysicalDNA dataset tooling")
    sub = parser.add_subparsers(dest="command", required=True)

    build = sub.add_parser("build", help="materialise a training layout from a manifest")
    build.add_argument("--manifest", type=Path, required=True)
    build.add_argument("--out", type=Path, required=True)

    audit_cmd = sub.add_parser("audit", help="report dataset health without writing anything")
    audit_cmd.add_argument("--manifest", type=Path, required=True)

    args = parser.parse_args()
    records = list(read_manifest(args.manifest))

    if args.command == "audit":
        report = audit(records)
        print(json.dumps(report.model_dump(), indent=2))
        raise SystemExit(0 if report.ok else 1)

    args.out.mkdir(parents=True, exist_ok=True)
    for split in ("train", "val", "benchmark"):
        (args.out / split).mkdir(exist_ok=True)
    grouped: defaultdict[str, list[ImageRecord]] = defaultdict(list)
    for record in records:
        grouped[assign_split(record.device_id)].append(record)
    for split, entries in grouped.items():
        target = args.out / split / "index.jsonl"
        target.write_text("\n".join(e.model_dump_json() for e in entries) + "\n")
        print(f"{split}: {len(entries)} images")


if __name__ == "__main__":
    main()
