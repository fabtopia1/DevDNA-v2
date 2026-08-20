import type { Surface } from '../taxonomy.js';
import type { CaptureView } from '../capture/views.js';
import type { CaptureInput } from '../validation/types.js';

/**
 * The detector boundary.
 *
 * Everything on the far side of this interface is a neural network, and
 * everything on this side is explainable. That is the whole point of putting
 * the seam here: DevDNA's claim is not that its model is interpretable, it is
 * that the model's *outputs are evidence* — located, versioned, reproducible —
 * and that every conclusion drawn from them cites the specific detection it
 * rests on.
 *
 * The model is a sensor. libimobiledevice reads a battery register; the
 * detector reads a photograph. Neither is trusted to decide what its reading
 * means.
 */

/** Normalised to 0..1 of image width/height, so it survives any resize. */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Detection {
  /** Stable id, assigned by the detector; carried into evidence. */
  detectionId: string;
  /** Which image this was found in. */
  imageId: string;
  view: CaptureView;
  /** Taxonomy class id. Must exist in DEFECT_CLASSES. */
  classId: string;
  surface: Surface;
  box: BoundingBox;
  /**
   * The model's raw output for this detection, 0..1.
   *
   * Recorded for the audit trail and used for nothing else. It is a statement
   * about a softmax, not about the world, and the two are only related through
   * calibration — which is applied separately and explicitly.
   */
  modelScore: number;
  /** Polygon or mask area as a share of the surface, where the class uses one. */
  extent?: number;
  /** Optional polygon, normalised, for classes annotated as POLYGON/MASK. */
  polygon?: Array<{ x: number; y: number }>;
}

export interface DetectorInfo {
  /** e.g. `physicaldna-detector`. */
  name: string;
  /** Semantic version of the weights, not the code. */
  version: string;
  /** Taxonomy version the weights were trained against. */
  taxonomyVersion: string;
  /** Id of the calibration table applied to this model's outputs. */
  calibrationId: string;
}

export interface DetectionResult {
  detector: DetectorInfo;
  detections: Detection[];
  /** Images the detector could not process, with the reason. */
  failures: Array<{ imageId: string; reason: string }>;
}

/**
 * Any defect detector.
 *
 * Implemented today by a deterministic mock; implemented in production by an
 * HTTP client onto the inference service. Nothing downstream knows or cares
 * which, and that is what allows the entire evidence, scoring and reporting
 * pipeline to be built, tested and reviewed before a single weight exists.
 */
export interface DefectDetector {
  info(): DetectorInfo;
  detect(captures: readonly CaptureInput[]): Promise<DetectionResult>;
}
