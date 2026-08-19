import { DataSource } from '../../types/common.js';
import { AppleServiceHistoryLabel, type RawDeviceSnapshot } from '../../types/device.js';
import { PartComponent, SignalPolarity, type PartSignal } from '../../types/parts.js';
import { asBoolean, asNumber, asString, pick } from '../../parsers/ideviceinfo.js';
import { resolveDevice } from '../../catalog/devices.js';

/**
 * A detector turns one collection surface into zero or more component signals.
 * Detectors never decide a verdict — that is the rule engine's job — so a new
 * evidence source can be added without touching verdict logic.
 */
export type PartDetector = (snapshot: RawDeviceSnapshot) => PartSignal[];

/** Map Apple's on-screen component wording onto our component enum. */
export function normaliseComponentName(label: string): PartComponent | null {
  const key = label.trim().toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ');
  const table: Record<string, PartComponent> = {
    display: PartComponent.DISPLAY,
    screen: PartComponent.DISPLAY,
    battery: PartComponent.BATTERY,
    camera: PartComponent.REAR_CAMERA,
    'rear camera': PartComponent.REAR_CAMERA,
    'back camera': PartComponent.REAR_CAMERA,
    'front camera': PartComponent.FRONT_CAMERA,
    'true depth camera': PartComponent.FRONT_CAMERA,
    'truedepth camera': PartComponent.FRONT_CAMERA,
    'face id': PartComponent.FACE_ID,
    faceid: PartComponent.FACE_ID,
    'touch id': PartComponent.TOUCH_ID,
    touchid: PartComponent.TOUCH_ID,
    'rear housing': PartComponent.REAR_HOUSING,
    housing: PartComponent.REAR_HOUSING,
    'logic board': PartComponent.LOGIC_BOARD,
    lidar: PartComponent.LIDAR,
    speaker: PartComponent.SPEAKER,
    'top speaker': PartComponent.SPEAKER,
    microphone: PartComponent.MICROPHONE,
    'taptic engine': PartComponent.TAPTIC_ENGINE,
  };
  return table[key] ?? null;
}

const LABEL_POLARITY: Record<
  AppleServiceHistoryLabel,
  { polarity: SignalPolarity; strength: number }
> = {
  [AppleServiceHistoryLabel.GENUINE_APPLE_PART]: {
    polarity: SignalPolarity.SUPPORTS_GENUINE,
    strength: 0.95,
  },
  [AppleServiceHistoryLabel.USED_APPLE_PART]: {
    polarity: SignalPolarity.SUPPORTS_USED,
    strength: 0.95,
  },
  [AppleServiceHistoryLabel.UNKNOWN_PART]: {
    polarity: SignalPolarity.SUPPORTS_UNKNOWN,
    strength: 0.95,
  },
  [AppleServiceHistoryLabel.UNABLE_TO_VERIFY]: {
    polarity: SignalPolarity.SUPPORTS_UNKNOWN,
    strength: 0.6,
  },
};

/**
 * Detector 1 — Apple's own Parts & Service History screen, transcribed by the
 * technician (or OCR'd from a screenshot).
 *
 * This is the only source that carries Apple's actual verdict, so it is the
 * strongest signal available without an AASP contract. It is second-hand by
 * construction — a human read a screen — which is exactly why it is modelled
 * as a high-strength signal rather than as ground truth: OCR misreads and
 * transcription mistakes stay visible in the confidence number.
 */
export const attestationDetector: PartDetector = (snapshot) => {
  const attestation = snapshot.attestation;
  if (!attestation) return [];

  const baseConfidence = attestation.method === 'OCR' ? 0.6 : 0.7;
  const source =
    attestation.method === 'OCR' ? DataSource.ATTESTATION_OCR : DataSource.TECHNICIAN_ATTESTATION;
  const signals: PartSignal[] = [];

  // iOS renders no Parts & Service History section at all when it holds no
  // service record for any component. On a model that supports the screen,
  // that absence is itself evidence of an unserviced device.
  if (attestation.sectionAbsent) {
    const device = resolveDevice(asString(pick(snapshot.lockdown, 'ProductType')));
    if (device.recognised && device.generation >= 11) {
      for (const component of [
        PartComponent.DISPLAY,
        PartComponent.BATTERY,
        PartComponent.REAR_CAMERA,
      ]) {
        signals.push({
          id: `attestation.absent.${component}`,
          component,
          polarity: SignalPolarity.SUPPORTS_GENUINE,
          source,
          strength: 0.55,
          confidence: baseConfidence * 0.85,
          summary: 'iOS shows no Parts & Service History entries, indicating no recorded service',
        });
      }
    }
    return signals;
  }

  for (const entry of attestation.entries) {
    const component = normaliseComponentName(entry.component);
    if (!component) continue;
    const mapping = LABEL_POLARITY[entry.label];
    if (!mapping) continue;
    signals.push({
      id: `attestation.${component}`,
      component,
      polarity: mapping.polarity,
      source,
      strength: mapping.strength,
      confidence: baseConfidence,
      summary: `Apple Parts & Service History reports "${entry.label}"`,
      evidence: entry.label,
    });
  }
  return signals;
};

/**
 * Detector 2 — diagnostic strings harvested from aggregated analytics files.
 *
 * Component pairing failures leave traces in the device's own analytics. These
 * are weaker than an attestation (they can be stale, and absence proves
 * nothing) but they are fully automatic, which makes them the backbone of an
 * unattended inspection.
 */
const DIAGNOSTIC_SIGNAL_RULES: Array<{
  pattern: string;
  component: PartComponent;
  polarity: SignalPolarity;
  strength: number;
  summary: string;
}> = [
  {
    pattern: 'AppleSmartBatteryUnknownPart',
    component: PartComponent.BATTERY,
    polarity: SignalPolarity.SUPPORTS_UNKNOWN,
    strength: 0.85,
    summary: 'Battery reported as an unknown part in device analytics',
  },
  {
    pattern: 'BatteryUnknownPart',
    component: PartComponent.BATTERY,
    polarity: SignalPolarity.SUPPORTS_UNKNOWN,
    strength: 0.8,
    summary: 'Battery pairing failure recorded in device analytics',
  },
  {
    pattern: 'NonGenuineBattery',
    component: PartComponent.BATTERY,
    polarity: SignalPolarity.SUPPORTS_UNKNOWN,
    strength: 0.85,
    summary: 'Non-genuine battery flag recorded in device analytics',
  },
  {
    pattern: 'DisplaySerialMismatch',
    component: PartComponent.DISPLAY,
    polarity: SignalPolarity.SUPPORTS_USED,
    strength: 0.7,
    summary: 'Display serial does not match the serial this device was assembled with',
  },
  {
    pattern: 'AppleDisplayPipeAuthFailure',
    component: PartComponent.DISPLAY,
    polarity: SignalPolarity.SUPPORTS_UNKNOWN,
    strength: 0.75,
    summary: 'Display authentication failure recorded in device analytics',
  },
  {
    pattern: 'MultitouchCalibrationFailure',
    component: PartComponent.DISPLAY,
    polarity: SignalPolarity.SUPPORTS_UNKNOWN,
    strength: 0.5,
    summary: 'Touch calibration data missing or invalid, typical of a replaced panel',
  },
  {
    pattern: 'TrueToneDisabled',
    component: PartComponent.DISPLAY,
    polarity: SignalPolarity.SUPPORTS_USED,
    strength: 0.45,
    summary: 'True Tone unavailable, typical of a transplanted or third-party panel',
  },
  {
    pattern: 'FaceIDPairingFailure',
    component: PartComponent.FACE_ID,
    polarity: SignalPolarity.SUPPORTS_UNKNOWN,
    strength: 0.8,
    summary: 'Face ID module pairing failure recorded in device analytics',
  },
  {
    pattern: 'PearlNotPaired',
    component: PartComponent.FACE_ID,
    polarity: SignalPolarity.SUPPORTS_UNKNOWN,
    strength: 0.8,
    summary: 'TrueDepth (Pearl) module is not paired to this logic board',
  },
  {
    pattern: 'CameraPairingFailure',
    component: PartComponent.REAR_CAMERA,
    polarity: SignalPolarity.SUPPORTS_UNKNOWN,
    strength: 0.7,
    summary: 'Rear camera pairing failure recorded in device analytics',
  },
  {
    pattern: 'ServiceHistoryRecord',
    component: PartComponent.LOGIC_BOARD,
    polarity: SignalPolarity.SUPPORTS_SERVICED,
    strength: 0.4,
    summary: 'Device analytics contain a service history record',
  },
];

export const analyticsDetector: PartDetector = (snapshot) => {
  const strings = snapshot.analytics?.diagnosticStrings ?? [];
  if (strings.length === 0) return [];
  const lowered = new Set(strings.map((s) => s.toLowerCase()));
  const signals: PartSignal[] = [];
  for (const rule of DIAGNOSTIC_SIGNAL_RULES) {
    if (!lowered.has(rule.pattern.toLowerCase())) continue;
    signals.push({
      id: `analytics.${rule.pattern}`,
      component: rule.component,
      polarity: rule.polarity,
      source: DataSource.ANALYTICS_LOG,
      strength: rule.strength,
      confidence: 0.72,
      summary: rule.summary,
      evidence: `${rule.pattern} in ${snapshot.analytics?.sourceFile ?? 'analytics'}`,
    });
  }
  return signals;
};

/**
 * Detector 3 — battery cell identity from the IORegistry.
 *
 * A readable manufacturer serial with a plausible design capacity is
 * consistent with an Apple cell. A design capacity no iPhone ever shipped
 * with, or no serial at all while the registry is otherwise readable, is a
 * third-party pack tell.
 */
export const batteryHardwareDetector: PartDetector = (snapshot) => {
  const node = snapshot.ioregistry['AppleSmartBattery'];
  if (!node || Object.keys(node).length === 0) return [];
  const signals: PartSignal[] = [];

  const serial = asString(pick(node, 'Serial', 'BatterySerialNumber', 'SerialNumber'));
  const designCapacity = asNumber(pick(node, 'DesignCapacity'));

  if (serial && serial.length >= 8) {
    signals.push({
      id: 'battery.serial.present',
      component: PartComponent.BATTERY,
      polarity: SignalPolarity.SUPPORTS_GENUINE,
      source: DataSource.DIAGNOSTICS_RELAY,
      strength: 0.4,
      confidence: 0.85,
      summary: 'Battery reports a well-formed Apple cell serial',
      evidence: `serial length ${serial.length}`,
    });
  } else if (!serial) {
    signals.push({
      id: 'battery.serial.missing',
      component: PartComponent.BATTERY,
      polarity: SignalPolarity.SUPPORTS_UNKNOWN,
      source: DataSource.DIAGNOSTICS_RELAY,
      strength: 0.45,
      confidence: 0.6,
      summary: 'Battery reports no cell serial while the registry is otherwise readable',
    });
  }

  if (designCapacity !== null && (designCapacity < 800 || designCapacity > 6000)) {
    signals.push({
      id: 'battery.design.implausible',
      component: PartComponent.BATTERY,
      polarity: SignalPolarity.SUPPORTS_UNKNOWN,
      source: DataSource.DIAGNOSTICS_RELAY,
      strength: 0.6,
      confidence: 0.75,
      summary: `Design capacity of ${designCapacity} mAh is outside the range of any iPhone cell`,
      evidence: `DesignCapacity=${designCapacity}`,
    });
  }

  if (asBoolean(pick(node, 'BatteryInstalled')) === false) {
    signals.push({
      id: 'battery.not-installed',
      component: PartComponent.BATTERY,
      polarity: SignalPolarity.SUPPORTS_UNKNOWN,
      source: DataSource.DIAGNOSTICS_RELAY,
      strength: 0.7,
      confidence: 0.7,
      summary: 'Battery management controller reports no installed cell',
    });
  }

  return signals;
};

/**
 * Detector 4 — capability probes.
 *
 * True Tone requires the panel's factory calibration data, which does not
 * travel with a third-party or transplanted display. A model that shipped with
 * True Tone but reports it unsupported has almost always had its panel
 * replaced; likewise a Face ID model reporting no biometric capability.
 */
export const capabilityDetector: PartDetector = (snapshot) => {
  const gestalt = snapshot.domains['com.apple.mobile.mobilegestalt'] ?? {};
  const device = resolveDevice(asString(pick(snapshot.lockdown, 'ProductType')));
  if (!device.recognised) return [];
  const signals: PartSignal[] = [];

  // True Tone shipped with iPhone 8 / X and later.
  if (device.generation >= 8) {
    const trueTone = asBoolean(pick(gestalt, 'DisplaySupportsTrueTone', 'TrueToneSupported'));
    if (trueTone === false) {
      signals.push({
        id: 'capability.truetone.absent',
        component: PartComponent.DISPLAY,
        polarity: SignalPolarity.SUPPORTS_USED,
        source: DataSource.MOBILEGESTALT,
        strength: 0.6,
        confidence: 0.8,
        summary: `${device.marketingName} shipped with True Tone but reports it unsupported`,
        evidence: 'DisplaySupportsTrueTone=false',
      });
    } else if (trueTone === true) {
      signals.push({
        id: 'capability.truetone.present',
        component: PartComponent.DISPLAY,
        polarity: SignalPolarity.SUPPORTS_GENUINE,
        source: DataSource.MOBILEGESTALT,
        strength: 0.45,
        confidence: 0.8,
        summary: 'True Tone calibration data is present on the installed panel',
      });
    }
  }

  if (device.biometrics === 'FACE_ID') {
    const faceId = asBoolean(pick(gestalt, 'SupportsFaceID', 'FaceIDCapability'));
    if (faceId === false) {
      signals.push({
        id: 'capability.faceid.absent',
        component: PartComponent.FACE_ID,
        polarity: SignalPolarity.SUPPORTS_UNKNOWN,
        source: DataSource.MOBILEGESTALT,
        strength: 0.7,
        confidence: 0.8,
        summary: `${device.marketingName} shipped with Face ID but reports no Face ID capability`,
        evidence: 'SupportsFaceID=false',
      });
    } else if (faceId === true) {
      signals.push({
        id: 'capability.faceid.present',
        component: PartComponent.FACE_ID,
        polarity: SignalPolarity.SUPPORTS_GENUINE,
        source: DataSource.MOBILEGESTALT,
        strength: 0.4,
        confidence: 0.8,
        summary: 'Face ID hardware is present and reports capability',
      });
    }
  }

  return signals;
};

/** The default detector chain, in the order results are collected. */
export const DEFAULT_DETECTORS: PartDetector[] = [
  attestationDetector,
  analyticsDetector,
  batteryHardwareDetector,
  capabilityDetector,
];

export function collectPartSignals(
  snapshot: RawDeviceSnapshot,
  detectors: PartDetector[] = DEFAULT_DETECTORS,
): PartSignal[] {
  return detectors.flatMap((detector) => {
    try {
      return detector(snapshot);
    } catch {
      // A misbehaving detector must never fail a whole inspection.
      return [];
    }
  });
}
