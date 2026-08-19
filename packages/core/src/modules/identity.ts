import { EvidenceSubject } from '../evidence/types.js';
import type { EvidenceLedger } from '../evidence/ledger.js';
import {
  Determinacy,
  InferenceDirection,
  ModuleId,
  FindingBasis,
  Severity,
  type Finding,
  type Inference,
  type ModuleResult,
  type Verdict,
} from '../inference/types.js';
import type { ProvenanceEngine } from '../inference/provenance.js';
import { dampByCoverage, round, verdictConfidence } from '../confidence/model.js';
import {
  classifyUdid,
  decodeImei,
  decodeModelNumber,
  decodeSerial,
  SerialFormat,
  UdidFormat,
  UnitProvenanceClass,
  type DecodedImei,
  type DecodedModelNumber,
  type DecodedSerial,
} from '../catalog/identifiers.js';
import { hardwareSpecFor } from '../catalog/hardware-specs.js';
import { resolveDevice } from '../catalog/devices.js';
import { resolveRegion } from '../catalog/regions.js';
import { massFor } from './support.js';

/**
 * Module 1 - the Identity Engine.
 *
 * Asks one question: **are this device's identifiers consistent with each other
 * and with themselves?**
 *
 * It deliberately does not ask whether the hardware matches the model - that is
 * the Hardware Consistency Engine's job. The split matters because the two fail
 * for different reasons. Identifier inconsistency points at tampering,
 * transcription error, or a cloned identity. Hardware inconsistency points at
 * physical substitution.
 *
 * Identity is where DevDNA can actually catch a lie outright: an IMEI that
 * fails its own checksum is not a judgement call.
 */

export enum IdentityVerdict {
  IDENTITY_CONSISTENT = 'IDENTITY_CONSISTENT',
  IDENTITY_MISMATCH = 'IDENTITY_MISMATCH',
  CANNOT_DETERMINE = 'CANNOT_DETERMINE',
}

export interface IdentityDetail extends Record<string, unknown> {
  productType: string | null;
  marketingName: string | null;
  modelRecognised: boolean;
  modelNumber: DecodedModelNumber | null;
  serial: DecodedSerial | null;
  imei: DecodedImei | null;
  udidFormat: UdidFormat;
  /** How this unit reached the market, decoded from the model number prefix. */
  unitProvenance: UnitProvenanceClass;
  regionCode: string | null;
  regionName: string | null;
  /** Identifier checks that could actually be run on this device. */
  checksPerformed: string[];
  checksUnavailable: string[];
}

/** Cross-checks the engine attempts. Each is a named, citable rule. */
const CHECKS = [
  'imei.checksum',
  'serial.format-era',
  'udid.format-era',
  'model-number.wellformed',
  'device-class',
  'region.consistency',
  'imei.secondary-consistency',
  'serial.manufacture-era',
] as const;

export function runIdentityEngine(
  ledger: EvidenceLedger,
  provenance: ProvenanceEngine,
  at: string,
): { result: ModuleResult<IdentityVerdict>; findings: Finding[]; detail: IdentityDetail } {
  const inferences: Inference[] = [];
  const findings: Finding[] = [];
  const performed: string[] = [];
  const unavailable: string[] = [];

  const productTypeRecord = ledger.best(EvidenceSubject.DEVICE, 'ProductType');
  const productType = typeof productTypeRecord?.value === 'string' ? productTypeRecord.value : null;
  const device = resolveDevice(productType);
  const spec = hardwareSpecFor(productType);

  const modelNumberRecord = ledger.best(EvidenceSubject.DEVICE, 'ModelNumber');
  const serialRecord = ledger.best(EvidenceSubject.DEVICE, 'SerialNumber');
  const imeiRecord = ledger.best(EvidenceSubject.DEVICE, 'InternationalMobileEquipmentIdentity');
  const imei2Record = ledger.best(EvidenceSubject.DEVICE, 'InternationalMobileEquipmentIdentity2');
  const udidRecord = ledger.best(EvidenceSubject.DEVICE, 'UniqueDeviceID');
  const deviceClassRecord = ledger.best(EvidenceSubject.DEVICE, 'DeviceClass');
  const regionRecord = ledger.best(EvidenceSubject.DEVICE, 'RegionInfo');

  const modelNumber = modelNumberRecord ? decodeModelNumber(String(modelNumberRecord.value)) : null;
  const serial = serialRecord ? decodeSerial(String(serialRecord.value)) : null;
  const imei = imeiRecord ? decodeImei(String(imeiRecord.value)) : null;
  const udidFormat = udidRecord ? classifyUdid(String(udidRecord.value)) : UdidFormat.UNKNOWN;
  const region = resolveRegion(regionRecord ? String(regionRecord.value) : null);

  const derive = (input: {
    rule: string;
    direction: InferenceDirection;
    statement: string;
    weight: number;
    ruleConfidence: number;
    evidenceIds: string[];
  }): void => {
    inferences.push(
      provenance.derive({
        module: ModuleId.IDENTITY,
        subject: EvidenceSubject.DEVICE,
        at,
        ...input,
      }),
    );
  };

  // --- Check 1: IMEI checksum -------------------------------------------
  // The one identifier check with a mathematical answer. A device reporting an
  // IMEI that fails Luhn is reporting something no network would accept.
  if (imei && imeiRecord) {
    performed.push('imei.checksum');
    if (!imei.wellFormed) {
      derive({
        rule: 'identity.imei-malformed',
        direction: InferenceDirection.SUPPORTS_NEGATIVE,
        statement: 'Reported IMEI is not 15 digits',
        weight: 0.8,
        ruleConfidence: 0.95,
        evidenceIds: [imeiRecord.id],
      });
    } else if (!imei.checksumValid) {
      derive({
        rule: 'identity.imei-checksum-invalid',
        direction: InferenceDirection.SUPPORTS_NEGATIVE,
        statement: 'Reported IMEI fails its Luhn check digit, so it is not a valid IMEI',
        weight: 0.95,
        ruleConfidence: 0.98,
        evidenceIds: [imeiRecord.id],
      });
      findings.push({
        code: 'IDENTITY_IMEI_INVALID',
        basis: FindingBasis.EVIDENCE,
        severity: Severity.CRITICAL,
        module: ModuleId.IDENTITY,
        title: 'IMEI fails its checksum',
        detail:
          'The IMEI this device reports is not arithmetically valid. That is consistent with a ' +
          'modified identity and should be resolved before any purchase.',
        evidenceIds: [imeiRecord.id],
        inferenceIds: [],
      });
    } else {
      derive({
        rule: 'identity.imei-checksum-valid',
        direction: InferenceDirection.SUPPORTS_POSITIVE,
        statement: 'IMEI passes its Luhn check digit',
        weight: 0.5,
        ruleConfidence: 0.9,
        evidenceIds: [imeiRecord.id],
      });
    }
  } else {
    unavailable.push('imei.checksum');
  }

  // --- Check 2: secondary IMEI consistency -------------------------------
  // Dual-SIM devices report two IMEIs sharing a Type Allocation Code, because
  // both radios are the same model. Differing TACs mean the identifiers did not
  // come from one handset.
  if (imei?.tac && imei2Record) {
    performed.push('imei.secondary-consistency');
    const imei2 = decodeImei(String(imei2Record.value));
    if (imei2.wellFormed && imei2.tac && imei2.tac !== imei.tac) {
      derive({
        rule: 'identity.imei-tac-divergent',
        direction: InferenceDirection.SUPPORTS_NEGATIVE,
        statement: `Primary and secondary IMEIs carry different type allocation codes (${imei.tac} vs ${imei2.tac})`,
        weight: 0.7,
        ruleConfidence: 0.85,
        evidenceIds: [imeiRecord!.id, imei2Record.id],
      });
    } else if (imei2.wellFormed) {
      derive({
        rule: 'identity.imei-tac-consistent',
        direction: InferenceDirection.SUPPORTS_POSITIVE,
        statement: 'Primary and secondary IMEIs share a type allocation code',
        weight: 0.35,
        ruleConfidence: 0.8,
        evidenceIds: [imeiRecord!.id, imei2Record.id],
      });
    }
  } else {
    unavailable.push('imei.secondary-consistency');
  }

  // --- Check 3: serial format against production era ---------------------
  if (serial && serialRecord && spec && ledger.best(EvidenceSubject.DEVICE, 'ExpectedSerialFormats')) {
    performed.push('serial.format-era');
    const expectedRecord = ledger.best(EvidenceSubject.DEVICE, 'ExpectedSerialFormats');

    if (serial.format === SerialFormat.UNKNOWN) {
      derive({
        rule: 'identity.serial-format-unrecognised',
        direction: InferenceDirection.SUPPORTS_NEGATIVE,
        statement: 'Serial number does not match any Apple serial format',
        weight: 0.6,
        ruleConfidence: 0.85,
        evidenceIds: [serialRecord.id],
      });
    } else if (!spec.expectedSerialFormats.includes(serial.format)) {
      derive({
        rule: 'identity.serial-format-era-mismatch',
        direction: InferenceDirection.SUPPORTS_NEGATIVE,
        statement:
          `Serial is in ${serial.format} format, which ${spec.productType} was never shipped with`,
        weight: 0.65,
        ruleConfidence: 0.8,
        evidenceIds: [serialRecord.id, expectedRecord!.id],
      });
    } else {
      derive({
        rule: 'identity.serial-format-consistent',
        direction: InferenceDirection.SUPPORTS_POSITIVE,
        statement: `Serial format matches the era ${spec.productType} was produced in`,
        weight: 0.4,
        ruleConfidence: 0.85,
        evidenceIds: [serialRecord.id, expectedRecord!.id],
      });
    }
  } else {
    unavailable.push('serial.format-era');
  }

  // --- Check 4: legacy serial manufacture year vs model release ----------
  // Only legacy serials encode a date; randomised serials carry none, so this
  // check is skipped rather than guessed at.
  if (
    serial?.manufactureYear &&
    serialRecord &&
    device.recognised &&
    device.releaseYear &&
    ledger.best(EvidenceSubject.DEVICE, 'ExpectedReleaseYear')
  ) {
    performed.push('serial.manufacture-era');
    const releaseRecord = ledger.best(EvidenceSubject.DEVICE, 'ExpectedReleaseYear');
    // A unit cannot be manufactured before its model existed. One year of slack
    // absorbs pre-release production and year-code coarseness.
    if (serial.manufactureYear < device.releaseYear - 1) {
      derive({
        rule: 'identity.serial-predates-model',
        direction: InferenceDirection.SUPPORTS_NEGATIVE,
        statement:
          `Serial encodes manufacture in ${serial.manufactureYear}, before ${device.marketingName} ` +
          `was released in ${device.releaseYear}`,
        weight: 0.7,
        ruleConfidence: 0.75,
        evidenceIds: [serialRecord.id, releaseRecord!.id],
      });
    } else {
      derive({
        rule: 'identity.serial-era-plausible',
        direction: InferenceDirection.SUPPORTS_POSITIVE,
        statement: `Serial manufacture year ${serial.manufactureYear} is consistent with the model`,
        weight: 0.3,
        ruleConfidence: 0.7,
        evidenceIds: [serialRecord.id, releaseRecord!.id],
      });
    }
  } else {
    unavailable.push('serial.manufacture-era');
  }

  // --- Check 5: UDID format against production era -----------------------
  if (udidRecord && spec && ledger.best(EvidenceSubject.DEVICE, 'ExpectedUdidFormat')) {
    performed.push('udid.format-era');
    const expectedRecord = ledger.best(EvidenceSubject.DEVICE, 'ExpectedUdidFormat');
    if (udidFormat === UdidFormat.UNKNOWN) {
      derive({
        rule: 'identity.udid-format-unrecognised',
        direction: InferenceDirection.SUPPORTS_NEGATIVE,
        statement: 'Device identifier does not match any Apple UDID format',
        weight: 0.6,
        ruleConfidence: 0.85,
        evidenceIds: [udidRecord.id],
      });
    } else if (udidFormat !== spec.expectedUdidFormat) {
      derive({
        rule: 'identity.udid-format-era-mismatch',
        direction: InferenceDirection.SUPPORTS_NEGATIVE,
        statement: `UDID is in ${udidFormat} format, which ${spec.productType} does not use`,
        weight: 0.6,
        ruleConfidence: 0.8,
        evidenceIds: [udidRecord.id, expectedRecord!.id],
      });
    } else {
      derive({
        rule: 'identity.udid-format-consistent',
        direction: InferenceDirection.SUPPORTS_POSITIVE,
        statement: 'Device identifier format matches this model generation',
        weight: 0.35,
        ruleConfidence: 0.85,
        evidenceIds: [udidRecord.id, expectedRecord!.id],
      });
    }
  } else {
    unavailable.push('udid.format-era');
  }

  // --- Check 6: model number well-formedness and unit provenance ---------
  if (modelNumber && modelNumberRecord) {
    performed.push('model-number.wellformed');
    if (!modelNumber.wellFormed) {
      derive({
        rule: 'identity.model-number-malformed',
        direction: InferenceDirection.SUPPORTS_NEGATIVE,
        statement: `Model number ${modelNumber.raw} does not match Apple's format`,
        weight: 0.5,
        ruleConfidence: 0.8,
        evidenceIds: [modelNumberRecord.id],
      });
    } else {
      derive({
        rule: 'identity.model-number-wellformed',
        direction: InferenceDirection.SUPPORTS_POSITIVE,
        statement: 'Model number is well formed',
        weight: 0.3,
        ruleConfidence: 0.85,
        evidenceIds: [modelNumberRecord.id],
      });
    }

    // Unit provenance is not an identity fault, but it is material to price and
    // is the kind of thing sellers omit. Surfaced as a finding, never as a
    // negative inference: a refurbished unit has a perfectly valid identity.
    if (
      modelNumber.provenanceClass === UnitProvenanceClass.APPLE_REFURBISHED ||
      modelNumber.provenanceClass === UnitProvenanceClass.SERVICE_REPLACEMENT ||
      modelNumber.provenanceClass === UnitProvenanceClass.DEMO
    ) {
      findings.push({
        code: `IDENTITY_UNIT_${modelNumber.provenanceClass}`,
        basis: FindingBasis.EVIDENCE,
        severity:
          modelNumber.provenanceClass === UnitProvenanceClass.DEMO ? Severity.HIGH : Severity.MEDIUM,
        module: ModuleId.IDENTITY,
        title: UNIT_PROVENANCE_TITLES[modelNumber.provenanceClass] ?? 'Unit provenance note',
        detail:
          UNIT_PROVENANCE_DETAILS[modelNumber.provenanceClass] ??
          'The model number prefix indicates this unit was not sold as new retail stock.',
        evidenceIds: [modelNumberRecord.id],
        inferenceIds: [],
      });
    }
  } else {
    unavailable.push('model-number.wellformed');
  }

  // --- Check 7: device class --------------------------------------------
  if (deviceClassRecord) {
    performed.push('device-class');
    const deviceClass = String(deviceClassRecord.value);
    if (deviceClass !== 'iPhone') {
      derive({
        rule: 'identity.device-class-unexpected',
        direction: InferenceDirection.SUPPORTS_NEGATIVE,
        statement: `Device reports class ${deviceClass}, but DevDNA inspects iPhone hardware only`,
        weight: 0.5,
        ruleConfidence: 0.9,
        evidenceIds: [deviceClassRecord.id],
      });
    } else {
      derive({
        rule: 'identity.device-class-expected',
        direction: InferenceDirection.SUPPORTS_POSITIVE,
        statement: 'Device reports itself as an iPhone',
        weight: 0.25,
        ruleConfidence: 0.9,
        evidenceIds: [deviceClassRecord.id],
      });
    }
  } else {
    unavailable.push('device-class');
  }

  // --- Check 8: region consistency ---------------------------------------
  // Only runs when the model number actually carries a region suffix; lockdown
  // usually reports the bare code, so this is frequently unavailable.
  if (regionRecord && modelNumber?.regionSuffix && modelNumberRecord) {
    performed.push('region.consistency');
    const reported = String(regionRecord.value).trim().toUpperCase();
    if (reported !== modelNumber.regionSuffix) {
      derive({
        rule: 'identity.region-mismatch',
        direction: InferenceDirection.SUPPORTS_NEGATIVE,
        statement: `Region info ${reported} disagrees with the model number suffix ${modelNumber.regionSuffix}`,
        weight: 0.55,
        ruleConfidence: 0.8,
        evidenceIds: [regionRecord.id, modelNumberRecord.id],
      });
    } else {
      derive({
        rule: 'identity.region-consistent',
        direction: InferenceDirection.SUPPORTS_POSITIVE,
        statement: 'Region info agrees with the model number suffix',
        weight: 0.3,
        ruleConfidence: 0.8,
        evidenceIds: [regionRecord.id, modelNumberRecord.id],
      });
    }
  } else {
    unavailable.push('region.consistency');
  }

  // --- Conclude ----------------------------------------------------------
  const negative = massFor(inferences, InferenceDirection.SUPPORTS_NEGATIVE);
  const positive = massFor(inferences, InferenceDirection.SUPPORTS_POSITIVE);

  let verdict: Verdict<IdentityVerdict>;

  if (inferences.length === 0) {
    verdict = provenance.conclude<IdentityVerdict>({
      module: ModuleId.IDENTITY,
      subject: EvidenceSubject.DEVICE,
      value: IdentityVerdict.CANNOT_DETERMINE,
      determinacy: Determinacy.INDETERMINATE,
      confidence: 0,
      rationale: 'No identifier was readable, so no consistency check could be performed.',
      inferenceIds: [],
    });
  } else if (negative.positive > 0) {
    // Any genuine inconsistency dominates. Identity is not a weighted opinion:
    // one identifier that contradicts the others is a mismatch, whatever else
    // agrees.
    const scored = verdictConfidence({
      supporting: negative.supporting,
      opposingMass: negative.negative,
      ledger,
    });
    verdict = provenance.conclude<IdentityVerdict>({
      module: ModuleId.IDENTITY,
      subject: EvidenceSubject.DEVICE,
      value: IdentityVerdict.IDENTITY_MISMATCH,
      determinacy: Determinacy.DETERMINED,
      confidence: Math.max(scored.confidence, 0.3),
      rationale: negative.supporting
        .map((i) => i.statement)
        .slice(0, 3)
        .join('; '),
      inferenceIds: negative.supporting.map((i) => i.id),
    });
  } else {
    const scored = verdictConfidence({
      supporting: positive.supporting,
      opposingMass: 0,
      ledger,
    });
    verdict = provenance.conclude<IdentityVerdict>({
      module: ModuleId.IDENTITY,
      subject: EvidenceSubject.DEVICE,
      value: IdentityVerdict.IDENTITY_CONSISTENT,
      determinacy: Determinacy.DETERMINED,
      confidence: scored.confidence,
      rationale: `${performed.length} identifier check${performed.length === 1 ? '' : 's'} passed with no contradiction.`,
      inferenceIds: positive.supporting.map((i) => i.id),
    });
  }

  const coverage = round(performed.length / CHECKS.length);
  const confidence = dampByCoverage(verdict.confidence, coverage);

  if (unavailable.length > 0 && verdict.value !== IdentityVerdict.IDENTITY_MISMATCH) {
    findings.push({
      code: 'IDENTITY_PARTIAL_COVERAGE',
      basis: FindingBasis.ABSENCE,
      severity: unavailable.length >= CHECKS.length - 2 ? Severity.MEDIUM : Severity.LOW,
      module: ModuleId.IDENTITY,
      title: `${performed.length} of ${CHECKS.length} identifier checks could be run`,
      detail: `Not available on this device: ${unavailable.join(', ')}.`,
      // A claim about checks that could not run cites nothing by construction.
      evidenceIds: [],
      inferenceIds: [],
    });
  }

  const detail: IdentityDetail = {
    productType,
    marketingName: device.recognised ? device.marketingName : null,
    modelRecognised: device.recognised,
    modelNumber,
    serial,
    imei,
    udidFormat,
    unitProvenance: modelNumber?.provenanceClass ?? UnitProvenanceClass.UNKNOWN,
    regionCode: region.code,
    regionName: region.name,
    checksPerformed: performed,
    checksUnavailable: unavailable,
  };

  return {
    result: {
      module: ModuleId.IDENTITY,
      verdicts: [verdict],
      inferences,
      coverage,
      confidence,
      detail,
    },
    findings,
    detail,
  };
}

const UNIT_PROVENANCE_TITLES: Record<string, string | undefined> = {
  [UnitProvenanceClass.APPLE_REFURBISHED]: 'Apple refurbished unit',
  [UnitProvenanceClass.SERVICE_REPLACEMENT]: 'Service replacement unit',
  [UnitProvenanceClass.DEMO]: 'Demonstration unit, not intended for resale',
};

const UNIT_PROVENANCE_DETAILS: Record<string, string | undefined> = {
  [UnitProvenanceClass.APPLE_REFURBISHED]:
    'The model number prefix F identifies this as refurbished and resold by Apple. Genuine ' +
    'hardware, but it is not retail stock and is usually priced below it.',
  [UnitProvenanceClass.SERVICE_REPLACEMENT]:
    'The model number prefix N identifies this as a replacement unit issued under warranty or ' +
    'service. Genuine hardware, but it was never sold at retail and should be described as such.',
  [UnitProvenanceClass.DEMO]:
    'The model number prefix 3 identifies this as a demonstration unit. These are not intended ' +
    'for resale and may carry usage restrictions.',
};
