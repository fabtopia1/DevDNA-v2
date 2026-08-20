import { Surface } from '../taxonomy.js';

/**
 * The guided capture plan.
 *
 * Ten views, each with a stated purpose and the surfaces it is allowed to
 * produce evidence about. That last part matters more than it looks: a
 * detection on the rear-glass surface found in the *front* view is a bug, not a
 * finding, and constraining it here is what lets the evidence adapter reject it
 * rather than quietly scoring a device on a misattributed defect.
 */

export enum CaptureView {
  FRONT = 'FRONT',
  BACK = 'BACK',
  LEFT_EDGE = 'LEFT_EDGE',
  RIGHT_EDGE = 'RIGHT_EDGE',
  TOP_EDGE = 'TOP_EDGE',
  BOTTOM_EDGE = 'BOTTOM_EDGE',
  CAMERA_MODULE = 'CAMERA_MODULE',
  DISPLAY_ON = 'DISPLAY_ON',
  DISPLAY_OFF = 'DISPLAY_OFF',
  CLOSE_UP = 'CLOSE_UP',
}

/**
 * What the display must be showing.
 *
 * Display defects are only separable from surface defects by what is behind the
 * glass, and that is only visible against a controlled field. A "display on"
 * photograph of a home screen is nearly useless for this: burn-in hides in the
 * UI it was burned from.
 */
export enum DisplayState {
  OFF = 'OFF',
  WHITE_FIELD = 'WHITE_FIELD',
  BLACK_FIELD = 'BLACK_FIELD',
  GREY_FIELD = 'GREY_FIELD',
  NOT_APPLICABLE = 'NOT_APPLICABLE',
}

export interface ViewSpec {
  view: CaptureView;
  label: string;
  /** Why this view exists. Shown in the capture UI as the framing instruction. */
  instruction: string;
  /** Surfaces a detection in this view may be attributed to. */
  surfaces: Surface[];
  displayState: DisplayState;
  /** A view without which no meaningful assessment is possible. */
  required: boolean;
  /** Minimum long-edge pixels after validation. */
  minLongEdgePx: number;
  /**
   * Sharpness floor for this view.
   *
   * Higher for close work: a hairline crack occupies a handful of pixels, and
   * at the edge-view threshold it is indistinguishable from sensor noise.
   */
  minSharpness: number;
  /** How many of this view may be captured. Close-ups are open-ended. */
  maxCaptures: number;
}

export const VIEW_SPECS: ViewSpec[] = [
  {
    view: CaptureView.FRONT,
    label: 'Front',
    instruction:
      'Device flat, screen off, filling the frame. Angle the light so it does not ' +
      'reflect straight back into the lens.',
    surfaces: [Surface.FRONT_GLASS, Surface.FRAME, Surface.FRONT_CAMERA],
    displayState: DisplayState.OFF,
    required: true,
    minLongEdgePx: 1600,
    minSharpness: 120,
    maxCaptures: 3,
  },
  {
    view: CaptureView.BACK,
    label: 'Back',
    instruction: 'Device flat, rear panel filling the frame, camera module fully visible.',
    surfaces: [Surface.REAR_GLASS, Surface.FRAME, Surface.REAR_CAMERA],
    displayState: DisplayState.NOT_APPLICABLE,
    required: true,
    minLongEdgePx: 1600,
    minSharpness: 120,
    maxCaptures: 3,
  },
  {
    view: CaptureView.LEFT_EDGE,
    label: 'Left edge',
    instruction: 'Edge-on, volume buttons and SIM tray in frame, whole length visible.',
    surfaces: [Surface.FRAME],
    displayState: DisplayState.NOT_APPLICABLE,
    required: true,
    minLongEdgePx: 1200,
    minSharpness: 100,
    maxCaptures: 2,
  },
  {
    view: CaptureView.RIGHT_EDGE,
    label: 'Right edge',
    instruction: 'Edge-on, power button in frame, whole length visible.',
    surfaces: [Surface.FRAME],
    displayState: DisplayState.NOT_APPLICABLE,
    required: true,
    minLongEdgePx: 1200,
    minSharpness: 100,
    maxCaptures: 2,
  },
  {
    view: CaptureView.TOP_EDGE,
    label: 'Top edge',
    instruction: 'Top edge-on, whole length visible.',
    surfaces: [Surface.FRAME],
    displayState: DisplayState.NOT_APPLICABLE,
    required: false,
    minLongEdgePx: 1200,
    minSharpness: 100,
    maxCaptures: 2,
  },
  {
    view: CaptureView.BOTTOM_EDGE,
    label: 'Bottom edge',
    instruction:
      'Bottom edge-on, charge port and both screw bosses clearly in frame. Get close ' +
      'enough to read the screw heads.',
    surfaces: [Surface.FRAME, Surface.CHARGE_PORT],
    displayState: DisplayState.NOT_APPLICABLE,
    required: true,
    minLongEdgePx: 1400,
    minSharpness: 140,
    maxCaptures: 2,
  },
  {
    view: CaptureView.CAMERA_MODULE,
    label: 'Camera module',
    instruction:
      'Close on the camera bump, every lens in frame, no reflection across the glass.',
    surfaces: [Surface.REAR_CAMERA],
    displayState: DisplayState.NOT_APPLICABLE,
    required: true,
    minLongEdgePx: 1400,
    minSharpness: 160,
    maxCaptures: 3,
  },
  {
    view: CaptureView.DISPLAY_ON,
    label: 'Display on',
    instruction:
      'Screen showing the DevDNA test pattern at full brightness, filling the frame, ' +
      'photographed square-on.',
    surfaces: [Surface.DISPLAY_ACTIVE_AREA],
    displayState: DisplayState.WHITE_FIELD,
    required: true,
    minLongEdgePx: 1600,
    minSharpness: 110,
    maxCaptures: 4,
  },
  {
    view: CaptureView.DISPLAY_OFF,
    label: 'Display off',
    instruction: 'Screen off, photographed square-on under diffuse light.',
    surfaces: [Surface.FRONT_GLASS],
    displayState: DisplayState.OFF,
    required: true,
    minLongEdgePx: 1600,
    minSharpness: 120,
    maxCaptures: 2,
  },
  {
    view: CaptureView.CLOSE_UP,
    label: 'Close-up',
    instruction: 'Close on the area of interest, filling at least half the frame.',
    surfaces: [
      Surface.FRONT_GLASS,
      Surface.DISPLAY_ACTIVE_AREA,
      Surface.REAR_GLASS,
      Surface.FRAME,
      Surface.REAR_CAMERA,
      Surface.FRONT_CAMERA,
      Surface.CHARGE_PORT,
    ],
    displayState: DisplayState.NOT_APPLICABLE,
    required: false,
    minLongEdgePx: 1400,
    minSharpness: 150,
    maxCaptures: 12,
  },
];

const SPEC_BY_VIEW = new Map(VIEW_SPECS.map((spec) => [spec.view, spec]));

export const viewSpec = (view: CaptureView): ViewSpec => {
  const spec = SPEC_BY_VIEW.get(view);
  if (!spec) throw new Error(`Unknown capture view: ${view}`);
  return spec;
};

export const REQUIRED_VIEWS = VIEW_SPECS.filter((spec) => spec.required).map((s) => s.view);

/**
 * Which views can produce evidence about a surface.
 *
 * A surface is assessable only if at least one of its views passed validation.
 * Note that several surfaces have more than one qualifying view: that is what
 * lets corroboration across genuinely independent images raise confidence,
 * exactly as two independent data sources do in SoftwareDNA.
 */
export const VIEWS_FOR_SURFACE: Record<Surface, CaptureView[]> = Object.fromEntries(
  Object.values(Surface).map((surface) => [
    surface,
    VIEW_SPECS.filter((spec) => spec.surfaces.includes(surface)).map((spec) => spec.view),
  ]),
) as Record<Surface, CaptureView[]>;
