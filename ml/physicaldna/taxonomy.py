"""Taxonomy loader.

The taxonomy is generated from ``packages/physical/src/taxonomy.ts``; this
module only reads it. If you find yourself wanting to add a class here, add it
there and regenerate.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

DEFAULT_PATH = Path(__file__).resolve().parent.parent / "taxonomy.json"


@dataclass(frozen=True)
class DefectClass:
    index: int
    id: str
    group: str
    label: str
    nature: str
    surfaces: tuple[str, ...]
    geometry: str
    severity_weight: float
    trust_relevant: bool
    annotation_rule: str

    @property
    def is_segmentation(self) -> bool:
        """Mask/polygon classes need a segmentation head, not a box head."""
        return self.geometry in {"POLYGON", "MASK"}


@dataclass(frozen=True)
class Taxonomy:
    version: str
    classes: tuple[DefectClass, ...]

    @property
    def names(self) -> dict[int, str]:
        """Ultralytics-style index -> name map."""
        return {entry.index: entry.id for entry in self.classes}

    def by_id(self, class_id: str) -> DefectClass:
        for entry in self.classes:
            if entry.id == class_id:
                return entry
        raise KeyError(f"unknown class {class_id}")

    def for_surface(self, surface: str) -> tuple[DefectClass, ...]:
        return tuple(e for e in self.classes if surface in e.surfaces)

    @property
    def segmentation_classes(self) -> tuple[DefectClass, ...]:
        return tuple(e for e in self.classes if e.is_segmentation)


@lru_cache(maxsize=4)
def load_taxonomy(path: Path | str = DEFAULT_PATH) -> Taxonomy:
    payload = json.loads(Path(path).read_text())
    classes = tuple(
        DefectClass(
            index=entry["index"],
            id=entry["id"],
            group=entry["group"],
            label=entry["label"],
            nature=entry["nature"],
            surfaces=tuple(entry["surfaces"]),
            geometry=entry["geometry"],
            severity_weight=entry["severityWeight"],
            trust_relevant=entry["trustRelevant"],
            annotation_rule=entry["annotationRule"],
        )
        for entry in payload["classes"]
    )
    # Index must equal position, or the model's class ids stop meaning what the
    # scorer thinks they mean.
    for position, entry in enumerate(classes):
        if entry.index != position:
            raise ValueError(f"taxonomy index gap at {position}: {entry.id}")
    return Taxonomy(version=payload["taxonomyVersion"], classes=classes)
