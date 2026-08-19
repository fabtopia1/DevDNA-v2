import { UdidFormat } from './identifiers.js';
import { SerialFormat } from './identifiers.js';

/**
 * Expected hardware specification per product type.
 *
 * The Hardware Consistency Engine compares what a device *reports* against what
 * the model is *known to be*. That only works if "known to be" is real data
 * with real provenance, so this table is treated as catalog evidence
 * (`EvidenceSource.DEVDNA_CATALOG`) and cited by every inference that uses it.
 *
 * A product type absent from this table yields no expectations at all, and the
 * engine abstains rather than inventing a baseline to compare against.
 */
export interface HardwareSpec {
  productType: string;
  /** Board identifiers (`HardwareModel`) Apple shipped for this product type. */
  boardIds: string[];
  /** Storage tiers, in GB, this model was sold in. */
  capacitiesGb: number[];
  cpuArchitecture: 'arm64' | 'arm64e';
  chip: string;
  /** Design capacity of the original cell, in mAh, with tolerance. */
  designCapacityMah: number;
  deviceClass: 'iPhone';
  /** Identifier formats consistent with this model's production era. */
  expectedUdidFormat: UdidFormat;
  expectedSerialFormats: SerialFormat[];
}

const spec = (
  productType: string,
  boardIds: string[],
  capacitiesGb: number[],
  cpuArchitecture: HardwareSpec['cpuArchitecture'],
  chip: string,
  designCapacityMah: number,
  expectedUdidFormat: UdidFormat,
  expectedSerialFormats: SerialFormat[],
): HardwareSpec => ({
  productType,
  boardIds,
  capacitiesGb,
  cpuArchitecture,
  chip,
  designCapacityMah,
  deviceClass: 'iPhone',
  expectedUdidFormat,
  expectedSerialFormats,
});

const LEGACY = [SerialFormat.LEGACY_12];
const TRANSITION = [SerialFormat.LEGACY_12, SerialFormat.RANDOMISED_10];
const MODERN_SERIAL = [SerialFormat.RANDOMISED_10];

const SPECS: HardwareSpec[] = [
  spec('iPhone8,1', ['N71AP', 'N71mAP'], [16, 32, 64, 128], 'arm64', 'A9', 1715, UdidFormat.LEGACY_40, LEGACY),
  spec('iPhone8,2', ['N66AP', 'N66mAP'], [16, 32, 64, 128], 'arm64', 'A9', 2750, UdidFormat.LEGACY_40, LEGACY),
  spec('iPhone8,4', ['N69AP', 'N69uAP'], [16, 32, 64, 128], 'arm64', 'A9', 1624, UdidFormat.LEGACY_40, LEGACY),
  spec('iPhone9,1', ['D10AP'], [32, 128, 256], 'arm64', 'A10 Fusion', 1960, UdidFormat.LEGACY_40, LEGACY),
  spec('iPhone9,3', ['D101AP'], [32, 128, 256], 'arm64', 'A10 Fusion', 1960, UdidFormat.LEGACY_40, LEGACY),
  spec('iPhone9,2', ['D11AP'], [32, 128, 256], 'arm64', 'A10 Fusion', 2900, UdidFormat.LEGACY_40, LEGACY),
  spec('iPhone9,4', ['D111AP'], [32, 128, 256], 'arm64', 'A10 Fusion', 2900, UdidFormat.LEGACY_40, LEGACY),
  spec('iPhone10,1', ['D20AP'], [64, 256], 'arm64e', 'A11 Bionic', 1821, UdidFormat.LEGACY_40, LEGACY),
  spec('iPhone10,4', ['D201AP'], [64, 256], 'arm64e', 'A11 Bionic', 1821, UdidFormat.LEGACY_40, LEGACY),
  spec('iPhone10,2', ['D21AP'], [64, 256], 'arm64e', 'A11 Bionic', 2691, UdidFormat.LEGACY_40, LEGACY),
  spec('iPhone10,5', ['D211AP'], [64, 256], 'arm64e', 'A11 Bionic', 2691, UdidFormat.LEGACY_40, LEGACY),
  spec('iPhone10,3', ['D22AP'], [64, 256], 'arm64e', 'A11 Bionic', 2716, UdidFormat.MODERN, LEGACY),
  spec('iPhone10,6', ['D221AP'], [64, 256], 'arm64e', 'A11 Bionic', 2716, UdidFormat.MODERN, LEGACY),
  spec('iPhone11,2', ['D321AP'], [64, 256, 512], 'arm64e', 'A12 Bionic', 2658, UdidFormat.MODERN, LEGACY),
  spec('iPhone11,4', ['D331AP'], [64, 256, 512], 'arm64e', 'A12 Bionic', 3174, UdidFormat.MODERN, LEGACY),
  spec('iPhone11,6', ['D331pAP'], [64, 256, 512], 'arm64e', 'A12 Bionic', 3174, UdidFormat.MODERN, LEGACY),
  spec('iPhone11,8', ['N841AP'], [64, 128, 256], 'arm64e', 'A12 Bionic', 2942, UdidFormat.MODERN, LEGACY),
  spec('iPhone12,1', ['N104AP'], [64, 128, 256], 'arm64e', 'A13 Bionic', 3110, UdidFormat.MODERN, LEGACY),
  spec('iPhone12,3', ['D421AP'], [64, 256, 512], 'arm64e', 'A13 Bionic', 3046, UdidFormat.MODERN, LEGACY),
  spec('iPhone12,5', ['D431AP'], [64, 256, 512], 'arm64e', 'A13 Bionic', 3969, UdidFormat.MODERN, LEGACY),
  spec('iPhone12,8', ['D79AP'], [64, 128, 256], 'arm64e', 'A13 Bionic', 1821, UdidFormat.MODERN, TRANSITION),
  spec('iPhone13,1', ['D52gAP'], [64, 128, 256], 'arm64e', 'A14 Bionic', 2227, UdidFormat.MODERN, TRANSITION),
  spec('iPhone13,2', ['D53gAP'], [64, 128, 256], 'arm64e', 'A14 Bionic', 2815, UdidFormat.MODERN, TRANSITION),
  spec('iPhone13,3', ['D53pAP'], [128, 256, 512], 'arm64e', 'A14 Bionic', 2815, UdidFormat.MODERN, TRANSITION),
  spec('iPhone13,4', ['D54pAP'], [128, 256, 512], 'arm64e', 'A14 Bionic', 3687, UdidFormat.MODERN, TRANSITION),
  spec('iPhone14,4', ['D16AP'], [128, 256, 512], 'arm64e', 'A15 Bionic', 2406, UdidFormat.MODERN, MODERN_SERIAL),
  spec('iPhone14,5', ['D17AP'], [128, 256, 512], 'arm64e', 'A15 Bionic', 3227, UdidFormat.MODERN, MODERN_SERIAL),
  spec('iPhone14,2', ['D63AP'], [128, 256, 512, 1024], 'arm64e', 'A15 Bionic', 3095, UdidFormat.MODERN, MODERN_SERIAL),
  spec('iPhone14,3', ['D64AP'], [128, 256, 512, 1024], 'arm64e', 'A15 Bionic', 4352, UdidFormat.MODERN, MODERN_SERIAL),
  spec('iPhone14,6', ['D49AP'], [64, 128, 256], 'arm64e', 'A15 Bionic', 2018, UdidFormat.MODERN, MODERN_SERIAL),
  spec('iPhone14,7', ['D27AP'], [128, 256, 512], 'arm64e', 'A15 Bionic', 3279, UdidFormat.MODERN, MODERN_SERIAL),
  spec('iPhone14,8', ['D28AP'], [128, 256, 512], 'arm64e', 'A15 Bionic', 4325, UdidFormat.MODERN, MODERN_SERIAL),
  spec('iPhone15,2', ['D73AP'], [128, 256, 512, 1024], 'arm64e', 'A16 Bionic', 3200, UdidFormat.MODERN, MODERN_SERIAL),
  spec('iPhone15,3', ['D74AP'], [128, 256, 512, 1024], 'arm64e', 'A16 Bionic', 4323, UdidFormat.MODERN, MODERN_SERIAL),
  spec('iPhone15,4', ['D37AP'], [128, 256, 512], 'arm64e', 'A16 Bionic', 3349, UdidFormat.MODERN, MODERN_SERIAL),
  spec('iPhone15,5', ['D38AP'], [128, 256, 512], 'arm64e', 'A16 Bionic', 4383, UdidFormat.MODERN, MODERN_SERIAL),
  spec('iPhone16,1', ['D83AP'], [128, 256, 512, 1024], 'arm64e', 'A17 Pro', 3274, UdidFormat.MODERN, MODERN_SERIAL),
  spec('iPhone16,2', ['D84AP'], [256, 512, 1024], 'arm64e', 'A17 Pro', 4441, UdidFormat.MODERN, MODERN_SERIAL),
  spec('iPhone17,3', ['D47AP'], [128, 256, 512], 'arm64e', 'A18', 3561, UdidFormat.MODERN, MODERN_SERIAL),
  spec('iPhone17,4', ['D48AP'], [128, 256, 512], 'arm64e', 'A18', 4674, UdidFormat.MODERN, MODERN_SERIAL),
  spec('iPhone17,1', ['D93AP'], [128, 256, 512, 1024], 'arm64e', 'A18 Pro', 3582, UdidFormat.MODERN, MODERN_SERIAL),
  spec('iPhone17,2', ['D94AP'], [256, 512, 1024], 'arm64e', 'A18 Pro', 4685, UdidFormat.MODERN, MODERN_SERIAL),
  spec('iPhone17,5', ['V59AP'], [128, 256, 512], 'arm64e', 'A18', 4005, UdidFormat.MODERN, MODERN_SERIAL),
];

const BY_PRODUCT_TYPE = new Map(SPECS.map((entry) => [entry.productType, entry]));

export const HARDWARE_SPECS: readonly HardwareSpec[] = SPECS;

/**
 * Expected specification for a product type, or null when the model is not
 * catalogued. Null is a real answer: the Hardware Consistency Engine abstains
 * rather than comparing against a fabricated baseline.
 */
export function hardwareSpecFor(productType: string | null | undefined): HardwareSpec | null {
  return BY_PRODUCT_TYPE.get((productType ?? '').trim()) ?? null;
}

/**
 * Design capacity tolerance. Apple's own reported design capacity varies
 * slightly between cell suppliers and firmware revisions, so an exact match is
 * the wrong test; a genuine cell sits within a few percent of the spec, while a
 * third-party pack is usually well outside it or reports a round number.
 */
export const DESIGN_CAPACITY_TOLERANCE = 0.08;
