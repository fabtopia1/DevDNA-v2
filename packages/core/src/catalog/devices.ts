import { PartComponent } from '../types/parts.js';

export interface DeviceCatalogEntry {
  productType: string;
  marketingName: string;
  /** Marketing generation number used for part-applicability rules. */
  generation: number;
  releaseYear: number;
  /** Apple's rated cycle life before the cell drops to 80% capacity. */
  ratedCycleLife: number;
  biometrics: 'FACE_ID' | 'TOUCH_ID' | 'NONE';
  hasLidar: boolean;
  /** Number of rear camera modules. */
  rearCameras: number;
  /** Newest major iOS train the device can run. */
  maxIosMajor: number;
}

/**
 * Product-type catalog. Ships as data so it can be refreshed without a code
 * release: the API exposes `PUT /catalog/devices` for operators, and unknown
 * product types degrade gracefully (see `resolveDevice`) rather than guessing.
 *
 * `ratedCycleLife` is 1000 for iPhone 15 and later, where Apple raised the
 * rating, and 500 for earlier models.
 */
const ENTRIES: DeviceCatalogEntry[] = [
  // iPhone 6 / 6s / SE / 7 / 8 era — Touch ID
  e('iPhone7,2', 'iPhone 6', 6, 2014, 500, 'TOUCH_ID', false, 1, 12),
  e('iPhone7,1', 'iPhone 6 Plus', 6, 2014, 500, 'TOUCH_ID', false, 1, 12),
  e('iPhone8,1', 'iPhone 6s', 6, 2015, 500, 'TOUCH_ID', false, 1, 15),
  e('iPhone8,2', 'iPhone 6s Plus', 6, 2015, 500, 'TOUCH_ID', false, 1, 15),
  e('iPhone8,4', 'iPhone SE (1st generation)', 1, 2016, 500, 'TOUCH_ID', false, 1, 15),
  e('iPhone9,1', 'iPhone 7', 7, 2016, 500, 'TOUCH_ID', false, 1, 15),
  e('iPhone9,3', 'iPhone 7', 7, 2016, 500, 'TOUCH_ID', false, 1, 15),
  e('iPhone9,2', 'iPhone 7 Plus', 7, 2016, 500, 'TOUCH_ID', false, 2, 15),
  e('iPhone9,4', 'iPhone 7 Plus', 7, 2016, 500, 'TOUCH_ID', false, 2, 15),
  e('iPhone10,1', 'iPhone 8', 8, 2017, 500, 'TOUCH_ID', false, 1, 16),
  e('iPhone10,4', 'iPhone 8', 8, 2017, 500, 'TOUCH_ID', false, 1, 16),
  e('iPhone10,2', 'iPhone 8 Plus', 8, 2017, 500, 'TOUCH_ID', false, 2, 16),
  e('iPhone10,5', 'iPhone 8 Plus', 8, 2017, 500, 'TOUCH_ID', false, 2, 16),
  // Face ID era
  e('iPhone10,3', 'iPhone X', 10, 2017, 500, 'FACE_ID', false, 2, 16),
  e('iPhone10,6', 'iPhone X', 10, 2017, 500, 'FACE_ID', false, 2, 16),
  e('iPhone11,2', 'iPhone XS', 11, 2018, 500, 'FACE_ID', false, 2, 18),
  e('iPhone11,4', 'iPhone XS Max', 11, 2018, 500, 'FACE_ID', false, 2, 18),
  e('iPhone11,6', 'iPhone XS Max', 11, 2018, 500, 'FACE_ID', false, 2, 18),
  e('iPhone11,8', 'iPhone XR', 11, 2018, 500, 'FACE_ID', false, 1, 18),
  e('iPhone12,1', 'iPhone 11', 11, 2019, 500, 'FACE_ID', false, 2, 18),
  e('iPhone12,3', 'iPhone 11 Pro', 11, 2019, 500, 'FACE_ID', false, 3, 18),
  e('iPhone12,5', 'iPhone 11 Pro Max', 11, 2019, 500, 'FACE_ID', false, 3, 18),
  e('iPhone12,8', 'iPhone SE (2nd generation)', 2, 2020, 500, 'TOUCH_ID', false, 1, 18),
  e('iPhone13,1', 'iPhone 12 mini', 12, 2020, 500, 'FACE_ID', false, 2, 18),
  e('iPhone13,2', 'iPhone 12', 12, 2020, 500, 'FACE_ID', false, 2, 18),
  e('iPhone13,3', 'iPhone 12 Pro', 12, 2020, 500, 'FACE_ID', true, 3, 18),
  e('iPhone13,4', 'iPhone 12 Pro Max', 12, 2020, 500, 'FACE_ID', true, 3, 18),
  e('iPhone14,4', 'iPhone 13 mini', 13, 2021, 500, 'FACE_ID', false, 2, 18),
  e('iPhone14,5', 'iPhone 13', 13, 2021, 500, 'FACE_ID', false, 2, 18),
  e('iPhone14,2', 'iPhone 13 Pro', 13, 2021, 500, 'FACE_ID', true, 3, 18),
  e('iPhone14,3', 'iPhone 13 Pro Max', 13, 2021, 500, 'FACE_ID', true, 3, 18),
  e('iPhone14,6', 'iPhone SE (3rd generation)', 3, 2022, 500, 'TOUCH_ID', false, 1, 18),
  e('iPhone14,7', 'iPhone 14', 14, 2022, 500, 'FACE_ID', false, 2, 18),
  e('iPhone14,8', 'iPhone 14 Plus', 14, 2022, 500, 'FACE_ID', false, 2, 18),
  e('iPhone15,2', 'iPhone 14 Pro', 14, 2022, 500, 'FACE_ID', true, 3, 18),
  e('iPhone15,3', 'iPhone 14 Pro Max', 14, 2022, 500, 'FACE_ID', true, 3, 18),
  e('iPhone15,4', 'iPhone 15', 15, 2023, 1000, 'FACE_ID', false, 2, 18),
  e('iPhone15,5', 'iPhone 15 Plus', 15, 2023, 1000, 'FACE_ID', false, 2, 18),
  e('iPhone16,1', 'iPhone 15 Pro', 15, 2023, 1000, 'FACE_ID', true, 3, 18),
  e('iPhone16,2', 'iPhone 15 Pro Max', 15, 2023, 1000, 'FACE_ID', true, 3, 18),
  e('iPhone17,3', 'iPhone 16', 16, 2024, 1000, 'FACE_ID', false, 2, 18),
  e('iPhone17,4', 'iPhone 16 Plus', 16, 2024, 1000, 'FACE_ID', false, 2, 18),
  e('iPhone17,1', 'iPhone 16 Pro', 16, 2024, 1000, 'FACE_ID', true, 3, 18),
  e('iPhone17,2', 'iPhone 16 Pro Max', 16, 2024, 1000, 'FACE_ID', true, 3, 18),
  e('iPhone17,5', 'iPhone 16e', 16, 2025, 1000, 'FACE_ID', false, 1, 18),
];

function e(
  productType: string,
  marketingName: string,
  generation: number,
  releaseYear: number,
  ratedCycleLife: number,
  biometrics: DeviceCatalogEntry['biometrics'],
  hasLidar: boolean,
  rearCameras: number,
  maxIosMajor = 18,
): DeviceCatalogEntry {
  return {
    productType,
    marketingName,
    generation,
    releaseYear,
    ratedCycleLife,
    biometrics,
    hasLidar,
    rearCameras,
    maxIosMajor,
  };
}

const BY_PRODUCT_TYPE = new Map(ENTRIES.map((entry) => [entry.productType, entry]));

export const DEVICE_CATALOG: readonly DeviceCatalogEntry[] = ENTRIES;

export interface ResolvedDevice extends DeviceCatalogEntry {
  recognised: boolean;
}

/**
 * Resolve a product type to catalog metadata.
 *
 * Unknown product types (a model released after this catalog was published)
 * return a conservative synthetic entry flagged `recognised: false`, rather
 * than a guessed marketing name. Downstream engines degrade to lower
 * confidence instead of asserting something false about the hardware.
 */
export function resolveDevice(productType: string | null | undefined): ResolvedDevice {
  const key = (productType ?? '').trim();
  const hit = BY_PRODUCT_TYPE.get(key);
  if (hit) return { ...hit, recognised: true };

  const major = Number.parseInt(/^iPhone(\d+),/.exec(key)?.[1] ?? '', 10);
  // iPhone17,x shipped as iPhone 16. Newer hardware revisions are assumed to
  // carry at least the capabilities of the newest catalogued generation.
  const assumedModern = Number.isFinite(major) && major >= 17;
  return {
    productType: key || 'unknown',
    marketingName: key ? `iPhone (${key})` : 'Unknown iPhone',
    generation: 0,
    releaseYear: 0,
    ratedCycleLife: assumedModern ? 1000 : 500,
    biometrics: assumedModern ? 'FACE_ID' : 'NONE',
    hasLidar: false,
    rearCameras: assumedModern ? 2 : 1,
    maxIosMajor: 99,
    recognised: false,
  };
}

/** Components that physically exist on a given model. */
export function applicableComponents(device: ResolvedDevice): PartComponent[] {
  const parts: PartComponent[] = [
    PartComponent.DISPLAY,
    PartComponent.BATTERY,
    PartComponent.REAR_CAMERA,
    PartComponent.FRONT_CAMERA,
    PartComponent.LOGIC_BOARD,
    PartComponent.REAR_HOUSING,
    PartComponent.SPEAKER,
    PartComponent.MICROPHONE,
    PartComponent.TAPTIC_ENGINE,
  ];
  if (device.biometrics === 'FACE_ID') parts.push(PartComponent.FACE_ID);
  if (device.biometrics === 'TOUCH_ID') parts.push(PartComponent.TOUCH_ID);
  if (device.hasLidar) parts.push(PartComponent.LIDAR);
  return parts;
}

/**
 * Marketing capacities in GB. `TotalDiskCapacity` is always smaller than the
 * advertised figure (formatting overhead), so we snap upward to the nearest
 * marketing tier.
 */
const CAPACITY_TIERS_GB = [16, 32, 64, 128, 256, 512, 1024, 2048];

export function inferMarketingCapacityGb(totalDiskCapacityBytes: number | null): number | null {
  if (!totalDiskCapacityBytes || totalDiskCapacityBytes <= 0) return null;
  const gb = totalDiskCapacityBytes / 1000 ** 3;
  for (const tier of CAPACITY_TIERS_GB) {
    // Real-world usable capacity sits at roughly 90-97% of the marketing tier.
    if (gb <= tier * 1.02) return tier;
  }
  return null;
}
