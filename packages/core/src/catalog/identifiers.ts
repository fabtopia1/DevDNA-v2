/**
 * Apple identifier formats.
 *
 * These decoders exist so the Identity Engine can cross-check identifiers
 * against each other instead of trusting any single one. Every function is
 * total: unknown input yields an explicit UNKNOWN, never a guess.
 */

/**
 * What the model number prefix says about how the unit reached the market.
 *
 * This matters commercially more than almost anything else DevDNA reads: a
 * service-replacement or refurbished unit is legitimately Apple hardware but is
 * priced differently from retail stock, and a seller describing an `N`-prefix
 * device as "new, sealed" is misrepresenting it.
 */
export enum UnitProvenanceClass {
  /** M - sold new at retail. */
  RETAIL = 'RETAIL',
  /** F - refurbished and resold by Apple. */
  APPLE_REFURBISHED = 'APPLE_REFURBISHED',
  /** N - replacement unit issued under warranty or service. */
  SERVICE_REPLACEMENT = 'SERVICE_REPLACEMENT',
  /** P - personalised (engraved) at point of sale. */
  PERSONALISED = 'PERSONALISED',
  /** 3 - demo unit, not intended for resale. */
  DEMO = 'DEMO',
  UNKNOWN = 'UNKNOWN',
}

const PREFIX_CLASS: Record<string, UnitProvenanceClass> = {
  M: UnitProvenanceClass.RETAIL,
  F: UnitProvenanceClass.APPLE_REFURBISHED,
  N: UnitProvenanceClass.SERVICE_REPLACEMENT,
  P: UnitProvenanceClass.PERSONALISED,
  '3': UnitProvenanceClass.DEMO,
};

export interface DecodedModelNumber {
  /** The full value as reported, e.g. `MQ0G3LL/A` or `MQ0G3`. */
  raw: string;
  prefix: string | null;
  provenanceClass: UnitProvenanceClass;
  /** Region suffix when present, e.g. `LL/A`. */
  regionSuffix: string | null;
  wellFormed: boolean;
}

/**
 * Decode a model number.
 *
 * lockdown usually reports the bare code (`MQ0G3`); the region suffix appears
 * on the packaging and in some domains, so both forms are accepted.
 */
export function decodeModelNumber(modelNumber: string | null | undefined): DecodedModelNumber {
  const raw = (modelNumber ?? '').trim().toUpperCase();
  if (!raw) {
    return {
      raw: '',
      prefix: null,
      provenanceClass: UnitProvenanceClass.UNKNOWN,
      regionSuffix: null,
      wellFormed: false,
    };
  }

  // Split on the slash first. A single regex cannot do this reliably: the part
  // code and the region code are both alphanumeric and adjacent, so a greedy
  // middle group silently swallows the first letter of the region
  // (MQ0G3LL/A would decode its region as L/A rather than LL/A).
  const slash = raw.indexOf('/');
  let code = raw;
  let regionSuffix: string | null = null;
  let wellFormed: boolean;

  if (slash >= 0) {
    const left = raw.slice(0, slash);
    const country = raw.slice(slash + 1);
    // Apple part codes are five characters; anything after them is the region.
    code = left.slice(0, PART_CODE_LENGTH);
    const regionLetters = left.slice(PART_CODE_LENGTH);
    regionSuffix = regionLetters ? `${regionLetters}/${country}` : null;
    wellFormed =
      /^[A-Z0-9]{5}$/.test(code) &&
      /^[A-Z]{1,2}$/.test(regionLetters) &&
      /^[A-Z]$/.test(country);
  } else {
    // lockdown usually reports the bare code with no region suffix.
    wellFormed = /^[A-Z0-9]{4,6}$/.test(code);
  }

  const prefix = code[0] ?? null;

  return {
    raw,
    prefix,
    provenanceClass: prefix ? (PREFIX_CLASS[prefix] ?? UnitProvenanceClass.UNKNOWN) : UnitProvenanceClass.UNKNOWN,
    regionSuffix,
    wellFormed,
  };
}

/** Apple part codes are five characters, e.g. `MQ0G3`. */
const PART_CODE_LENGTH = 5;

export enum SerialFormat {
  /** 12 characters, encodes factory and manufacture week. Pre-2021 devices. */
  LEGACY_12 = 'LEGACY_12',
  /** 10 characters, fully randomised. Devices from roughly 2021 onward. */
  RANDOMISED_10 = 'RANDOMISED_10',
  UNKNOWN = 'UNKNOWN',
}

export interface DecodedSerial {
  raw: string;
  format: SerialFormat;
  /**
   * Manufacture year decoded from a legacy serial, when derivable. Null for
   * randomised serials, which carry no date by design.
   */
  manufactureYear: number | null;
}

/**
 * Apple's legacy 12-character serial encodes the manufacture year and week in
 * positions 4-5. Randomised 10-character serials encode nothing, so this
 * returns null rather than inventing a date.
 */
const LEGACY_YEAR_CODES = 'CDFGHJKLMNPQRSTVWXYZ';

export function decodeSerial(serial: string | null | undefined): DecodedSerial {
  const raw = (serial ?? '').trim().toUpperCase();
  if (!raw) return { raw: '', format: SerialFormat.UNKNOWN, manufactureYear: null };

  if (/^[A-Z0-9]{10}$/.test(raw)) {
    return { raw, format: SerialFormat.RANDOMISED_10, manufactureYear: null };
  }

  if (/^[A-Z0-9]{12}$/.test(raw)) {
    // Position 4 (0-indexed 3) is the year code; each letter covers a half-year
    // from 2010 onward.
    const yearCode = raw[3] ?? '';
    const index = LEGACY_YEAR_CODES.indexOf(yearCode);
    const manufactureYear = index >= 0 ? 2010 + Math.floor(index / 2) : null;
    return { raw, format: SerialFormat.LEGACY_12, manufactureYear };
  }

  return { raw, format: SerialFormat.UNKNOWN, manufactureYear: null };
}

export interface DecodedImei {
  raw: string;
  wellFormed: boolean;
  /** Luhn check digit validity. A failed check means the value is not an IMEI. */
  checksumValid: boolean;
  /** Type Allocation Code: first 8 digits, identifies the model to the network. */
  tac: string | null;
}

/**
 * Validate an IMEI with the Luhn algorithm.
 *
 * This is a genuine consistency check, not a formality: a hand-edited or
 * transcribed-wrong IMEI almost always fails Luhn, and a device reporting an
 * IMEI that fails Luhn is reporting something that no network would accept.
 */
export function decodeImei(imei: string | null | undefined): DecodedImei {
  const raw = (imei ?? '').replace(/[\s-]/g, '').trim();
  if (!/^\d{15}$/.test(raw)) {
    return { raw, wellFormed: false, checksumValid: false, tac: null };
  }

  let sum = 0;
  for (let i = 0; i < 15; i += 1) {
    let digit = Number(raw[i]);
    // Double every second digit from the right; the check digit is position 15.
    if ((15 - i) % 2 === 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }

  return {
    raw,
    wellFormed: true,
    checksumValid: sum % 10 === 0,
    tac: raw.slice(0, 8),
  };
}

export enum UdidFormat {
  /** 8 hex, dash, 16 hex. iPhone X and later. */
  MODERN = 'MODERN',
  /** 40 hex characters. Pre-2018 devices. */
  LEGACY_40 = 'LEGACY_40',
  UNKNOWN = 'UNKNOWN',
}

export function classifyUdid(udid: string | null | undefined): UdidFormat {
  const raw = (udid ?? '').trim();
  if (/^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{16}$/.test(raw)) return UdidFormat.MODERN;
  if (/^[0-9A-Fa-f]{40}$/.test(raw)) return UdidFormat.LEGACY_40;
  return UdidFormat.UNKNOWN;
}
