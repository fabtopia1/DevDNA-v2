"""Benchmark a detector and emit the calibration artifact.

This is the only script in the pipeline whose output ships to production, and
what it ships is not a model — it is an honest statement of how often the model
is right, per class, measured on devices the model has never seen.

``packages/physical`` loads the result through ``loadCalibration()``. Precision
becomes the evidence reliability for a detection; recall becomes the confidence
of a *clean* verdict. That asymmetry is the point: precision bounds what a
detection means, recall bounds what an absence means, and a clean surface is
entirely a claim about absence.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from pathlib import Path

from .taxonomy import load_taxonomy

#: Below this many held-out instances a measurement is not a measurement.
#: Must match ``isMeasured`` in packages/physical/src/detection/calibration.ts.
MIN_BENCHMARK_SAMPLES = 50

#: IoU at which a prediction counts as matching a ground-truth instance.
MATCH_IOU = 0.5


@dataclass
class ClassCalibration:
    classId: str
    operatingThreshold: float
    precision: float
    recall: float
    sampleSize: int
    benchmarkVersion: str


def choose_operating_threshold(
    curve: list[tuple[float, float, float]],
    target_precision: float = 0.9,
) -> float:
    """Lowest threshold that still meets the precision target.

    Per class, not global. Hairline cracks and shattered glass do not share an
    operating point, and a single global threshold guarantees one class is
    over-triggering while another is silent.

    Precision is targeted rather than F1 because the costs are asymmetric here:
    a false positive tells a shop its stock is damaged when it is not, and one
    of those does more commercial damage than several misses.
    """
    qualifying = [(t, p, r) for t, p, r in curve if p >= target_precision]
    if not qualifying:
        # Nothing reaches the target; report the best available so the class is
        # visibly under-performing rather than silently thresholded to nothing.
        return max(curve, key=lambda entry: entry[1])[0] if curve else 0.99
    return min(qualifying, key=lambda entry: entry[0])[0]


def calibrate(
    per_class_curves: dict[str, list[tuple[float, float, float]]],
    per_class_support: dict[str, int],
    benchmark_version: str,
) -> list[ClassCalibration]:
    taxonomy = load_taxonomy()
    out: list[ClassCalibration] = []

    for entry in taxonomy.classes:
        curve = per_class_curves.get(entry.id, [])
        support = per_class_support.get(entry.id, 0)

        if support < MIN_BENCHMARK_SAMPLES or not curve:
            # Emitted with sampleSize as measured so the engine can see it is
            # below the floor and keep treating the class as uncalibrated.
            out.append(
                ClassCalibration(
                    classId=entry.id,
                    operatingThreshold=0.85,
                    precision=0.5,
                    recall=0.0,
                    sampleSize=support,
                    benchmarkVersion=benchmark_version,
                )
            )
            continue

        threshold = choose_operating_threshold(curve)
        precision, recall = next(
            (p, r) for t, p, r in curve if t == threshold
        )
        out.append(
            ClassCalibration(
                classId=entry.id,
                operatingThreshold=round(threshold, 4),
                precision=round(precision, 4),
                recall=round(recall, 4),
                sampleSize=support,
                benchmarkVersion=benchmark_version,
            )
        )

    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="Benchmark and calibrate a detector")
    parser.add_argument("--weights", type=Path, required=True)
    parser.add_argument("--split", default="benchmark")
    parser.add_argument("--build", type=Path, default=Path("data/build"))
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--benchmark-version", default="benchmark-unversioned")
    args = parser.parse_args()

    raise SystemExit(
        "Not implemented: requires a trained detector and an annotated benchmark split.\n"
        "The contract is fixed and tested on the TypeScript side — this script must emit\n"
        "a JSON array of {classId, operatingThreshold, precision, recall, sampleSize,\n"
        "benchmarkVersion}, computed at IoU "
        f"{MATCH_IOU} on devices absent from training.\n"
        f"Requested: {args.weights} -> {args.out} ({args.split})"
    )


if __name__ == "__main__":
    main()
