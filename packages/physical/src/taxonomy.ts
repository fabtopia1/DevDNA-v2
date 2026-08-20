import { EvidenceSubject, Severity } from '@devdna/core';

/**
 * The PhysicalDNA defect taxonomy.
 *
 * This file is the contract between four groups who otherwise never talk to
 * each other: the annotators drawing boxes, the model that learns the classes,
 * the scoring engine that prices them, and the technician reading the report.
 * A class that means one thing to an annotator and another to the scorer is the
 * single most expensive failure mode in a vision system, because it is
 * invisible until the metrics are already wrong.
 *
 * So every class carries, in one place: what it looks like, which surfaces it
 * can appear on, how it is annotated, what it costs, and whether it is a
 * cosmetic matter or a trust matter.
 *
 * TAXONOMY_VERSION is part of the evidence record for every detection. A class
 * whose definition changes gets a new version, because a score computed under
 * one definition is not comparable to a score computed under another.
 */
export const TAXONOMY_VERSION = '1.0.0';

/** Top-level grouping. Reporting and dataset balance are both done per group. */
export enum DefectGroup {
  SURFACE_DAMAGE = 'SURFACE_DAMAGE',
  FRAME_DAMAGE = 'FRAME_DAMAGE',
  CAMERA_DAMAGE = 'CAMERA_DAMAGE',
  DISPLAY_DEFECT = 'DISPLAY_DEFECT',
  WEAR = 'WEAR',
  MISSING_COMPONENT = 'MISSING_COMPONENT',
  REPAIR_INDICATOR = 'REPAIR_INDICATOR',
  CONTAMINATION = 'CONTAMINATION',
  ANOMALY = 'ANOMALY',
}

/**
 * What kind of problem this is, which is not the same as how big it is.
 *
 * A hairline crack is small and STRUCTURAL; heavy edge wear is large and
 * COSMETIC. Conflating the two is how grading systems end up pricing a
 * scuffed-but-sound handset below a pristine-looking cracked one.
 */
export enum DefectNature {
  /** Affects appearance only. Prices the device down; nothing is broken. */
  COSMETIC = 'COSMETIC',
  /** Affects or threatens function — sealing, optics, touch, structure. */
  FUNCTIONAL = 'FUNCTIONAL',
  /** Evidence the device has been opened, serviced or altered. */
  PROVENANCE = 'PROVENANCE',
}

/** How an annotator marks this class, and therefore what the model predicts. */
export enum AnnotationGeometry {
  /** Axis-aligned box. Discrete, countable damage. */
  BOX = 'BOX',
  /** Polygon. Damage whose extent matters more than its bounding rectangle. */
  POLYGON = 'POLYGON',
  /** Segmentation mask. Diffuse fields with no natural boundary. */
  MASK = 'MASK',
  /** Whole-image or whole-region label. Presence, not location. */
  REGION_TAG = 'REGION_TAG',
}

/** Physical surfaces PhysicalDNA reasons about. */
export enum Surface {
  FRONT_GLASS = 'FRONT_GLASS',
  DISPLAY_ACTIVE_AREA = 'DISPLAY_ACTIVE_AREA',
  REAR_GLASS = 'REAR_GLASS',
  FRAME = 'FRAME',
  REAR_CAMERA = 'REAR_CAMERA',
  FRONT_CAMERA = 'FRONT_CAMERA',
  CHARGE_PORT = 'CHARGE_PORT',
}

/**
 * Surfaces map onto the evidence subjects SoftwareDNA already uses.
 *
 * Front glass and the display's active area are both DISPLAY: they are two
 * views of one part, and keeping them under one subject is what lets a report
 * put "REPLACED_LIKELY" and "CONDITION_FAIR" on the same line.
 */
export const SURFACE_SUBJECT: Record<Surface, EvidenceSubject> = {
  [Surface.FRONT_GLASS]: EvidenceSubject.DISPLAY,
  [Surface.DISPLAY_ACTIVE_AREA]: EvidenceSubject.DISPLAY,
  [Surface.REAR_GLASS]: EvidenceSubject.REAR_HOUSING,
  [Surface.FRAME]: EvidenceSubject.FRAME,
  [Surface.REAR_CAMERA]: EvidenceSubject.REAR_CAMERA,
  [Surface.FRONT_CAMERA]: EvidenceSubject.FRONT_CAMERA,
  [Surface.CHARGE_PORT]: EvidenceSubject.CHARGE_PORT,
};

export interface DefectClass {
  /** Stable id. Never renamed — a rename is a new class plus a deprecation. */
  id: string;
  group: DefectGroup;
  /** Shown to technicians and printed on reports. */
  label: string;
  nature: DefectNature;
  /** Surfaces this class may legitimately appear on. */
  surfaces: Surface[];
  geometry: AnnotationGeometry;
  /**
   * 0..1 how much a single maximal instance of this class damages its surface.
   *
   * Calibrated against trade pricing, not against how alarming it looks. A
   * shattered rear glass is 0.95 because it costs most of the panel's value; a
   * light scratch is 0.06 because the trade barely prices it.
   */
  severityWeight: number;
  /** Severity band used when this class is surfaced as a finding. */
  findingSeverity: Severity;
  /** One line a technician can repeat to a customer. */
  impact: string;
  /**
   * True when the class is evidence the device was opened or altered, and so
   * belongs in the Service Evidence module's reasoning as well as here.
   *
   * This is the only route by which a physical observation may affect the trust
   * score. Cosmetic wear must never move trust: a scratched handset is not a
   * less trustworthy one, and a system that conflates condition with
   * trustworthiness produces a number that means neither.
   */
  trustRelevant: boolean;
  /** What the annotator must see to apply this label. */
  annotationRule: string;
  /** What it must NOT be confused with. Written from real confusion pairs. */
  notToBeConfusedWith?: string;
}

const S = Severity;

/**
 * The classes.
 *
 * Ordered by group. Every class in the product brief maps to exactly one entry;
 * where the brief named a symptom rather than a class ("broken glass", "deep
 * wear"), it is resolved into the class an annotator can actually apply
 * consistently.
 */
export const DEFECT_CLASSES: DefectClass[] = [
  // --- Surface damage -----------------------------------------------------
  {
    id: 'SCRATCH_LIGHT',
    group: DefectGroup.SURFACE_DAMAGE,
    label: 'Light scratch',
    nature: DefectNature.COSMETIC,
    surfaces: [Surface.FRONT_GLASS, Surface.REAR_GLASS, Surface.FRAME],
    geometry: AnnotationGeometry.BOX,
    severityWeight: 0.06,
    findingSeverity: S.INFO,
    impact: 'Visible in reflected light; does not affect use.',
    trustRelevant: false,
    annotationRule:
      'A linear mark visible only at an angle to the light, with no catch when a ' +
      'fingernail is drawn across it. Annotate each scratch separately while they ' +
      'are countable; switch to MICRO_ABRASION_FIELD past roughly eight in a region.',
    notToBeConfusedWith:
      'A reflection or a dust line. If it moves between the two captures of the ' +
      'same surface it is not a scratch.',
  },
  {
    id: 'SCRATCH_DEEP',
    group: DefectGroup.SURFACE_DAMAGE,
    label: 'Deep scratch',
    nature: DefectNature.COSMETIC,
    surfaces: [Surface.FRONT_GLASS, Surface.REAR_GLASS, Surface.FRAME],
    geometry: AnnotationGeometry.BOX,
    severityWeight: 0.18,
    findingSeverity: S.LOW,
    impact: 'Visible under any lighting; reduces resale grade.',
    trustRelevant: false,
    annotationRule:
      'A linear mark visible under diffuse light without tilting the device, ' +
      'showing displaced material or a white/bright core.',
    notToBeConfusedWith: 'CRACK_HAIRLINE, which propagates and has no width.',
  },
  {
    id: 'SCUFF',
    group: DefectGroup.SURFACE_DAMAGE,
    label: 'Scuff',
    nature: DefectNature.COSMETIC,
    surfaces: [Surface.REAR_GLASS, Surface.FRAME],
    geometry: AnnotationGeometry.POLYGON,
    severityWeight: 0.08,
    findingSeverity: S.INFO,
    impact: 'Surface marking without material loss.',
    trustRelevant: false,
    annotationRule: 'A non-linear dulled or marked region with no depth.',
  },
  {
    id: 'CRACK_HAIRLINE',
    group: DefectGroup.SURFACE_DAMAGE,
    label: 'Hairline crack',
    nature: DefectNature.FUNCTIONAL,
    surfaces: [Surface.FRONT_GLASS, Surface.REAR_GLASS],
    geometry: AnnotationGeometry.POLYGON,
    severityWeight: 0.55,
    findingSeverity: S.MEDIUM,
    impact: 'Glass integrity is compromised; the crack will propagate.',
    trustRelevant: false,
    annotationRule:
      'A fracture line through the glass, of no measurable width, following an ' +
      'irregular path. Trace the whole line as a polygon — length is what the ' +
      'scorer needs, and a bounding box of a diagonal crack overstates its area.',
    notToBeConfusedWith:
      'SCRATCH_DEEP, which is straight, has width, and does not branch.',
  },
  {
    id: 'CRACK_STRUCTURAL',
    group: DefectGroup.SURFACE_DAMAGE,
    label: 'Structural crack',
    nature: DefectNature.FUNCTIONAL,
    surfaces: [Surface.FRONT_GLASS, Surface.REAR_GLASS],
    geometry: AnnotationGeometry.POLYGON,
    severityWeight: 0.8,
    findingSeverity: S.HIGH,
    impact: 'Panel replacement required; sealing is compromised.',
    trustRelevant: false,
    annotationRule:
      'A fracture with visible width, branching, or an impact origin point.',
  },
  {
    id: 'SHATTERED_GLASS',
    group: DefectGroup.SURFACE_DAMAGE,
    label: 'Shattered glass',
    nature: DefectNature.FUNCTIONAL,
    surfaces: [Surface.FRONT_GLASS, Surface.REAR_GLASS],
    geometry: AnnotationGeometry.MASK,
    severityWeight: 0.95,
    findingSeverity: S.CRITICAL,
    impact: 'Panel destroyed; the device is unsafe to handle unrepaired.',
    trustRelevant: false,
    annotationRule:
      'Multiple intersecting fractures or missing glass. Mask the affected ' +
      'region rather than each fracture.',
  },
  {
    id: 'CHIP',
    group: DefectGroup.SURFACE_DAMAGE,
    label: 'Chip',
    nature: DefectNature.FUNCTIONAL,
    surfaces: [Surface.FRONT_GLASS, Surface.REAR_GLASS, Surface.FRAME],
    geometry: AnnotationGeometry.BOX,
    severityWeight: 0.35,
    findingSeverity: S.MEDIUM,
    impact: 'Material is missing; often the origin of a later crack.',
    trustRelevant: false,
    annotationRule: 'Material absent from an edge or surface, leaving a void.',
  },
  {
    id: 'GOUGE',
    group: DefectGroup.SURFACE_DAMAGE,
    label: 'Gouge',
    nature: DefectNature.FUNCTIONAL,
    surfaces: [Surface.REAR_GLASS, Surface.FRAME],
    geometry: AnnotationGeometry.BOX,
    severityWeight: 0.3,
    findingSeverity: S.MEDIUM,
    impact: 'Deep material displacement.',
    trustRelevant: false,
    annotationRule: 'A scratch deep enough to show displaced material at its edges.',
  },

  // --- Frame damage -------------------------------------------------------
  {
    id: 'DENT',
    group: DefectGroup.FRAME_DAMAGE,
    label: 'Dent',
    nature: DefectNature.FUNCTIONAL,
    surfaces: [Surface.FRAME],
    geometry: AnnotationGeometry.BOX,
    severityWeight: 0.32,
    findingSeverity: S.MEDIUM,
    impact: 'Impact deformation; may prevent a panel from seating flush.',
    trustRelevant: false,
    annotationRule: 'A localised depression breaking the frame’s edge line.',
  },
  {
    id: 'BENT_FRAME',
    group: DefectGroup.FRAME_DAMAGE,
    label: 'Bent frame',
    nature: DefectNature.FUNCTIONAL,
    surfaces: [Surface.FRAME],
    geometry: AnnotationGeometry.POLYGON,
    severityWeight: 0.75,
    findingSeverity: S.HIGH,
    impact: 'Chassis deformation; sealing and panel fit are compromised.',
    trustRelevant: false,
    annotationRule:
      'A deviation of the frame from a straight line along its length, judged ' +
      'against the opposite edge in the same image.',
  },
  {
    id: 'PAINT_WEAR',
    group: DefectGroup.FRAME_DAMAGE,
    label: 'Paint or coating wear',
    nature: DefectNature.COSMETIC,
    surfaces: [Surface.FRAME],
    geometry: AnnotationGeometry.POLYGON,
    severityWeight: 0.1,
    findingSeverity: S.INFO,
    impact: 'Finish worn through to the substrate.',
    trustRelevant: false,
    annotationRule: 'A region where the coating colour differs from the surrounding frame.',
  },
  {
    id: 'ANODISING_LOSS',
    group: DefectGroup.FRAME_DAMAGE,
    label: 'Anodising loss',
    nature: DefectNature.COSMETIC,
    surfaces: [Surface.FRAME],
    geometry: AnnotationGeometry.POLYGON,
    severityWeight: 0.12,
    findingSeverity: S.LOW,
    impact: 'Bare metal exposed; corrosion risk over time.',
    trustRelevant: false,
    annotationRule: 'Bright bare aluminium visible at a corner or edge.',
  },
  {
    id: 'EDGE_SEPARATION',
    group: DefectGroup.FRAME_DAMAGE,
    label: 'Panel separation',
    nature: DefectNature.FUNCTIONAL,
    surfaces: [Surface.FRAME],
    geometry: AnnotationGeometry.BOX,
    severityWeight: 0.6,
    findingSeverity: S.HIGH,
    impact: 'A panel is lifting from the chassis; the device is not sealed.',
    trustRelevant: true,
    annotationRule:
      'A visible gap between display or rear glass and the frame, wide enough to ' +
      'show a shadow line along its length.',
    notToBeConfusedWith:
      'The normal chamfer highlight, which is continuous and symmetrical on both edges.',
  },

  // --- Camera damage ------------------------------------------------------
  {
    id: 'LENS_SCRATCH',
    group: DefectGroup.CAMERA_DAMAGE,
    label: 'Lens scratch',
    nature: DefectNature.FUNCTIONAL,
    surfaces: [Surface.REAR_CAMERA, Surface.FRONT_CAMERA],
    geometry: AnnotationGeometry.BOX,
    severityWeight: 0.4,
    findingSeverity: S.MEDIUM,
    impact: 'Will appear as flare or softness in photographs.',
    trustRelevant: false,
    annotationRule: 'A scratch on the lens cover glass, inside the camera aperture.',
  },
  {
    id: 'LENS_CRACK',
    group: DefectGroup.CAMERA_DAMAGE,
    label: 'Lens crack',
    nature: DefectNature.FUNCTIONAL,
    surfaces: [Surface.REAR_CAMERA, Surface.FRONT_CAMERA],
    geometry: AnnotationGeometry.POLYGON,
    severityWeight: 0.7,
    findingSeverity: S.HIGH,
    impact: 'Photographs are affected; the camera is no longer sealed.',
    trustRelevant: false,
    annotationRule: 'A fracture in the lens cover glass.',
  },
  {
    id: 'LENS_SHATTERED',
    group: DefectGroup.CAMERA_DAMAGE,
    label: 'Shattered lens',
    nature: DefectNature.FUNCTIONAL,
    surfaces: [Surface.REAR_CAMERA, Surface.FRONT_CAMERA],
    geometry: AnnotationGeometry.MASK,
    severityWeight: 0.9,
    findingSeverity: S.CRITICAL,
    impact: 'Camera unusable without repair.',
    trustRelevant: false,
    annotationRule: 'Multiple fractures or missing glass over the lens.',
  },
  {
    id: 'CAMERA_MODULE_MISALIGNMENT',
    group: DefectGroup.CAMERA_DAMAGE,
    label: 'Camera module misalignment',
    nature: DefectNature.PROVENANCE,
    surfaces: [Surface.REAR_CAMERA],
    geometry: AnnotationGeometry.BOX,
    severityWeight: 0.45,
    findingSeverity: S.MEDIUM,
    impact: 'The module does not sit square in its housing.',
    trustRelevant: true,
    annotationRule:
      'A lens ring visibly rotated or offset relative to the camera bump, or an ' +
      'uneven gap around the module.',
  },
  {
    id: 'CAMERA_INTERNAL_DEBRIS',
    group: DefectGroup.CAMERA_DAMAGE,
    label: 'Debris inside camera',
    nature: DefectNature.FUNCTIONAL,
    surfaces: [Surface.REAR_CAMERA, Surface.FRONT_CAMERA],
    geometry: AnnotationGeometry.BOX,
    severityWeight: 0.5,
    findingSeverity: S.MEDIUM,
    impact: 'Particles behind the lens cover; the module has been opened or breached.',
    trustRelevant: true,
    annotationRule: 'Dust or fibres visible behind the lens glass, not on it.',
  },
  {
    id: 'LENS_COATING_DAMAGE',
    group: DefectGroup.CAMERA_DAMAGE,
    label: 'Lens coating damage',
    nature: DefectNature.FUNCTIONAL,
    surfaces: [Surface.REAR_CAMERA],
    geometry: AnnotationGeometry.POLYGON,
    severityWeight: 0.25,
    findingSeverity: S.LOW,
    impact: 'Anti-reflective coating degraded; increased flare.',
    trustRelevant: false,
    annotationRule: 'Patchy discolouration of the lens surface without a scratch line.',
  },

  // --- Display defects ----------------------------------------------------
  {
    id: 'DISPLAY_DEAD_PIXELS',
    group: DefectGroup.DISPLAY_DEFECT,
    label: 'Dead pixel cluster',
    nature: DefectNature.FUNCTIONAL,
    surfaces: [Surface.DISPLAY_ACTIVE_AREA],
    geometry: AnnotationGeometry.BOX,
    severityWeight: 0.4,
    findingSeverity: S.MEDIUM,
    impact: 'Permanently unlit pixels.',
    trustRelevant: false,
    annotationRule: 'Requires the display-on capture. Dark points that persist across test patterns.',
  },
  {
    id: 'DISPLAY_LINE_DEFECT',
    group: DefectGroup.DISPLAY_DEFECT,
    label: 'Display line',
    nature: DefectNature.FUNCTIONAL,
    surfaces: [Surface.DISPLAY_ACTIVE_AREA],
    geometry: AnnotationGeometry.BOX,
    severityWeight: 0.7,
    findingSeverity: S.HIGH,
    impact: 'Driver or panel fault; the display needs replacement.',
    trustRelevant: false,
    annotationRule: 'A full-width or full-height line of wrong or absent colour, display on.',
  },
  {
    id: 'DISPLAY_BURN_IN',
    group: DefectGroup.DISPLAY_DEFECT,
    label: 'Burn-in',
    nature: DefectNature.FUNCTIONAL,
    surfaces: [Surface.DISPLAY_ACTIVE_AREA],
    geometry: AnnotationGeometry.MASK,
    severityWeight: 0.45,
    findingSeverity: S.MEDIUM,
    impact: 'Permanent ghost image from static UI elements.',
    trustRelevant: false,
    annotationRule:
      'A persistent ghost of UI furniture on a flat grey test pattern. Only ' +
      'annotatable from the grey-field capture.',
  },
  {
    id: 'DISPLAY_BACKLIGHT_BLEED',
    group: DefectGroup.DISPLAY_DEFECT,
    label: 'Backlight bleed',
    nature: DefectNature.FUNCTIONAL,
    surfaces: [Surface.DISPLAY_ACTIVE_AREA],
    geometry: AnnotationGeometry.MASK,
    severityWeight: 0.3,
    findingSeverity: S.LOW,
    impact: 'Uneven brightness at the panel edge.',
    trustRelevant: false,
    annotationRule: 'Brightness gradient from an edge on a black test pattern.',
  },
  {
    id: 'DISPLAY_DISCOLOURATION',
    group: DefectGroup.DISPLAY_DEFECT,
    label: 'Display discolouration',
    nature: DefectNature.FUNCTIONAL,
    surfaces: [Surface.DISPLAY_ACTIVE_AREA],
    geometry: AnnotationGeometry.MASK,
    severityWeight: 0.35,
    findingSeverity: S.MEDIUM,
    impact: 'Colour cast across part of the panel.',
    trustRelevant: false,
    annotationRule: 'A region whose colour temperature differs on a white test pattern.',
    notToBeConfusedWith:
      'Camera white balance. Judge only within one image, never across images.',
  },
  {
    id: 'DISPLAY_PRESSURE_MARK',
    group: DefectGroup.DISPLAY_DEFECT,
    label: 'Pressure mark',
    nature: DefectNature.FUNCTIONAL,
    surfaces: [Surface.DISPLAY_ACTIVE_AREA],
    geometry: AnnotationGeometry.BOX,
    severityWeight: 0.4,
    findingSeverity: S.MEDIUM,
    impact: 'Localised panel damage from applied force.',
    trustRelevant: false,
    annotationRule: 'A bright or discoloured bloom on a grey field, without a surface mark above it.',
  },
  {
    id: 'DISPLAY_DELAMINATION',
    group: DefectGroup.DISPLAY_DEFECT,
    label: 'Delamination',
    nature: DefectNature.FUNCTIONAL,
    surfaces: [Surface.DISPLAY_ACTIVE_AREA, Surface.FRONT_GLASS],
    geometry: AnnotationGeometry.POLYGON,
    severityWeight: 0.55,
    findingSeverity: S.HIGH,
    impact: 'Digitiser separating from the panel.',
    trustRelevant: true,
    annotationRule: 'A rainbow or milky region between glass and panel, usually starting at an edge.',
  },

  // --- Wear ---------------------------------------------------------------
  {
    id: 'MICRO_ABRASION_FIELD',
    group: DefectGroup.WEAR,
    label: 'Micro-abrasion',
    nature: DefectNature.COSMETIC,
    surfaces: [Surface.FRONT_GLASS, Surface.REAR_GLASS, Surface.FRAME],
    geometry: AnnotationGeometry.MASK,
    severityWeight: 0.12,
    findingSeverity: S.INFO,
    impact: 'Fine wear consistent with normal pocket use.',
    trustRelevant: false,
    annotationRule:
      'A region of many scratches too numerous to count individually. Mask the ' +
      'region; do not annotate the constituent scratches.',
  },
  {
    id: 'HEAVY_WEAR_FIELD',
    group: DefectGroup.WEAR,
    label: 'Heavy wear',
    nature: DefectNature.COSMETIC,
    surfaces: [Surface.FRONT_GLASS, Surface.REAR_GLASS, Surface.FRAME],
    geometry: AnnotationGeometry.MASK,
    severityWeight: 0.3,
    findingSeverity: S.LOW,
    impact: 'Extensive wear across the surface; grade-limiting.',
    trustRelevant: false,
    annotationRule: 'Dense abrasion covering more than roughly a quarter of the surface.',
  },
  {
    id: 'BODY_DISCOLOURATION',
    group: DefectGroup.WEAR,
    label: 'Discolouration',
    nature: DefectNature.COSMETIC,
    surfaces: [Surface.REAR_GLASS, Surface.FRAME],
    geometry: AnnotationGeometry.MASK,
    severityWeight: 0.2,
    findingSeverity: S.LOW,
    impact: 'Colour change from heat, chemicals or UV exposure.',
    trustRelevant: false,
    annotationRule: 'A region whose colour differs from the rest of the same panel.',
  },

  // --- Missing components -------------------------------------------------
  {
    id: 'MISSING_SCREW',
    group: DefectGroup.MISSING_COMPONENT,
    label: 'Missing screw',
    nature: DefectNature.PROVENANCE,
    surfaces: [Surface.CHARGE_PORT, Surface.FRAME],
    geometry: AnnotationGeometry.BOX,
    severityWeight: 0.35,
    findingSeverity: S.MEDIUM,
    impact: 'A pentalobe screw is absent; the device has been opened.',
    trustRelevant: true,
    annotationRule: 'An empty screw boss beside the charge port.',
  },
  {
    id: 'MISSING_SIM_TRAY',
    group: DefectGroup.MISSING_COMPONENT,
    label: 'Missing SIM tray',
    nature: DefectNature.FUNCTIONAL,
    surfaces: [Surface.FRAME],
    geometry: AnnotationGeometry.BOX,
    severityWeight: 0.3,
    findingSeverity: S.MEDIUM,
    impact: 'Tray absent; the device is not sealed.',
    trustRelevant: false,
    annotationRule: 'An open SIM aperture with no tray seated.',
  },
  {
    id: 'MISSING_LENS_RING',
    group: DefectGroup.MISSING_COMPONENT,
    label: 'Missing lens ring',
    nature: DefectNature.PROVENANCE,
    surfaces: [Surface.REAR_CAMERA],
    geometry: AnnotationGeometry.BOX,
    severityWeight: 0.4,
    findingSeverity: S.MEDIUM,
    impact: 'The camera trim ring is absent; the module has been worked on.',
    trustRelevant: true,
    annotationRule: 'A lens aperture without its metal trim ring.',
  },
  {
    id: 'MISSING_BUTTON',
    group: DefectGroup.MISSING_COMPONENT,
    label: 'Missing button',
    nature: DefectNature.FUNCTIONAL,
    surfaces: [Surface.FRAME],
    geometry: AnnotationGeometry.BOX,
    severityWeight: 0.5,
    findingSeverity: S.HIGH,
    impact: 'A volume, power or action button is absent.',
    trustRelevant: false,
    annotationRule: 'An empty button aperture in the frame.',
  },

  // --- Repair indicators --------------------------------------------------
  {
    id: 'NON_OEM_SCREW',
    group: DefectGroup.REPAIR_INDICATOR,
    label: 'Non-OEM screw',
    nature: DefectNature.PROVENANCE,
    surfaces: [Surface.CHARGE_PORT, Surface.FRAME],
    geometry: AnnotationGeometry.BOX,
    severityWeight: 0.15,
    findingSeverity: S.MEDIUM,
    impact: 'A replacement screw is fitted; the device has been opened.',
    trustRelevant: true,
    annotationRule:
      'A screw whose head type (Phillips, flathead) is not the pentalobe Apple fits, ' +
      'or whose finish differs from its neighbour.',
  },
  {
    id: 'ADHESIVE_RESIDUE',
    group: DefectGroup.REPAIR_INDICATOR,
    label: 'Adhesive residue',
    nature: DefectNature.PROVENANCE,
    surfaces: [Surface.FRAME, Surface.FRONT_GLASS, Surface.REAR_GLASS],
    geometry: AnnotationGeometry.POLYGON,
    severityWeight: 0.15,
    findingSeverity: S.MEDIUM,
    impact: 'Aftermarket adhesive is visible at a seam.',
    trustRelevant: true,
    annotationRule: 'Glue visible at a panel seam, or a seam bead of uneven width.',
  },
  {
    id: 'PRY_MARK',
    group: DefectGroup.REPAIR_INDICATOR,
    label: 'Pry mark',
    nature: DefectNature.PROVENANCE,
    surfaces: [Surface.FRAME],
    geometry: AnnotationGeometry.BOX,
    severityWeight: 0.2,
    findingSeverity: S.MEDIUM,
    impact: 'Tool marks at a seam; the device has been opened.',
    trustRelevant: true,
    annotationRule: 'Short deformations or bright tool scars along a panel seam.',
    notToBeConfusedWith: 'Drop damage, which is not confined to the seam line.',
  },
  {
    id: 'PANEL_GAP',
    group: DefectGroup.REPAIR_INDICATOR,
    label: 'Uneven panel gap',
    nature: DefectNature.PROVENANCE,
    surfaces: [Surface.FRAME],
    geometry: AnnotationGeometry.POLYGON,
    severityWeight: 0.25,
    findingSeverity: S.MEDIUM,
    impact: 'A panel is not seated to factory tolerance.',
    trustRelevant: true,
    annotationRule: 'A seam whose width varies visibly along its length.',
  },
  {
    id: 'FINISH_MISMATCH',
    group: DefectGroup.REPAIR_INDICATOR,
    label: 'Mismatched finish',
    nature: DefectNature.PROVENANCE,
    surfaces: [Surface.FRAME, Surface.REAR_GLASS, Surface.REAR_CAMERA],
    geometry: AnnotationGeometry.POLYGON,
    severityWeight: 0.25,
    findingSeverity: S.MEDIUM,
    impact: 'A component’s colour or texture does not match the rest of the device.',
    trustRelevant: true,
    annotationRule:
      'A part whose hue or gloss differs from the adjoining part in the same image ' +
      'under the same light.',
    notToBeConfusedWith:
      'A lighting gradient. Requires the difference to persist across two views.',
  },
  {
    id: 'AFTERMARKET_MARKING',
    group: DefectGroup.REPAIR_INDICATOR,
    label: 'Aftermarket marking',
    nature: DefectNature.PROVENANCE,
    surfaces: [Surface.FRAME, Surface.REAR_GLASS],
    geometry: AnnotationGeometry.BOX,
    severityWeight: 0.2,
    findingSeverity: S.MEDIUM,
    impact: 'A repair shop label, engraving or asset tag is present.',
    trustRelevant: true,
    annotationRule: 'Any sticker, engraving or printed mark not applied by the manufacturer.',
  },

  // --- Contamination ------------------------------------------------------
  {
    id: 'CORROSION',
    group: DefectGroup.CONTAMINATION,
    label: 'Corrosion',
    nature: DefectNature.FUNCTIONAL,
    surfaces: [Surface.CHARGE_PORT, Surface.FRAME],
    geometry: AnnotationGeometry.POLYGON,
    severityWeight: 0.6,
    findingSeverity: S.HIGH,
    impact: 'Oxidation present; strongly associated with liquid exposure.',
    trustRelevant: true,
    annotationRule: 'Green, white or powdery deposits on metal, most often inside the charge port.',
  },
  {
    id: 'PORT_DEBRIS',
    group: DefectGroup.CONTAMINATION,
    label: 'Port debris',
    nature: DefectNature.COSMETIC,
    surfaces: [Surface.CHARGE_PORT],
    geometry: AnnotationGeometry.BOX,
    severityWeight: 0.1,
    findingSeverity: S.INFO,
    impact: 'Lint or debris in the charge port; may prevent charging until cleared.',
    trustRelevant: false,
    annotationRule: 'Compacted material inside the port cavity.',
  },
  {
    id: 'LIQUID_INDICATOR_TRIGGERED',
    group: DefectGroup.CONTAMINATION,
    label: 'Liquid contact indicator triggered',
    nature: DefectNature.PROVENANCE,
    surfaces: [Surface.FRAME],
    geometry: AnnotationGeometry.BOX,
    severityWeight: 0.5,
    findingSeverity: S.HIGH,
    impact: 'Apple’s liquid contact indicator has been activated.',
    trustRelevant: true,
    annotationRule:
      'The indicator visible in the SIM aperture is red rather than white or silver. ' +
      'Requires the dedicated SIM-slot close-up.',
  },

  // --- Anomaly ------------------------------------------------------------
  {
    id: 'UNCLASSIFIED_ANOMALY',
    group: DefectGroup.ANOMALY,
    label: 'Unclassified anomaly',
    nature: DefectNature.FUNCTIONAL,
    surfaces: [
      Surface.FRONT_GLASS,
      Surface.DISPLAY_ACTIVE_AREA,
      Surface.REAR_GLASS,
      Surface.FRAME,
      Surface.REAR_CAMERA,
      Surface.FRONT_CAMERA,
      Surface.CHARGE_PORT,
    ],
    geometry: AnnotationGeometry.BOX,
    severityWeight: 0.2,
    findingSeverity: S.LOW,
    impact: 'Something is present that does not match any known class.',
    trustRelevant: false,
    annotationRule:
      'Applied by a human reviewer only, never predicted at production confidence. ' +
      'Every instance is queued for taxonomy review: this class exists so that ' +
      'unknown damage is *recorded* rather than discarded, and a cluster of them is ' +
      'the signal that the taxonomy needs a new class.',
  },
];

const BY_ID = new Map(DEFECT_CLASSES.map((entry) => [entry.id, entry]));

export const defectClass = (id: string): DefectClass | undefined => BY_ID.get(id);

export const defectClassOrThrow = (id: string): DefectClass => {
  const entry = BY_ID.get(id);
  if (!entry) throw new Error(`Unknown defect class: ${id}`);
  return entry;
};

export const classesForSurface = (surface: Surface): DefectClass[] =>
  DEFECT_CLASSES.filter((entry) => entry.surfaces.includes(surface));

/** Classes that are evidence of service, and therefore feed trust. */
export const TRUST_RELEVANT_CLASSES = DEFECT_CLASSES.filter((entry) => entry.trustRelevant);

/** Every class id, for dataset tooling and model label maps. */
export const DEFECT_CLASS_IDS = DEFECT_CLASSES.map((entry) => entry.id);
