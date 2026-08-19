/**
 * Apple region codes as they appear in the lockdown `RegionInfo` key and the
 * suffix of the model number (`MQ0G3LL/A` -> `LL/A`). Region matters for
 * resale: carrier-locked variants, missing physical SIM trays and dual-eSIM
 * models are region-determined, and grey-import stock is a common source of
 * mismatch disputes between trading partners.
 */
const REGIONS: Record<string, string> = {
  AA: 'United Arab Emirates / Middle East',
  AB: 'Egypt / Middle East',
  AE: 'United Arab Emirates',
  AH: 'Middle East',
  B: 'United Kingdom / Ireland',
  BR: 'Brazil',
  BZ: 'Brazil',
  C: 'Canada',
  CH: 'China mainland',
  CN: 'China mainland',
  CZ: 'Czech Republic',
  D: 'Germany',
  DN: 'Austria / Germany / Netherlands',
  E: 'Mexico',
  EE: 'Estonia / Eastern Europe',
  El: 'Chile',
  ER: 'Ireland',
  ET: 'Estonia',
  F: 'France',
  FB: 'France / Luxembourg',
  FD: 'Austria / Liechtenstein / Switzerland',
  FS: 'Finland',
  GH: 'Hungary',
  GR: 'Greece',
  HB: 'Israel',
  HN: 'India',
  IN: 'India',
  IP: 'Italy',
  IT: 'Italy',
  J: 'Japan',
  JP: 'Japan',
  KH: 'China mainland / South Korea',
  KN: 'Denmark / Norway',
  KS: 'Finland / Sweden',
  LA: 'Latin America',
  LE: 'Argentina',
  LL: 'United States',
  LP: 'Poland',
  LT: 'Lithuania',
  LZ: 'Chile / Paraguay / Uruguay',
  MG: 'Hungary',
  MM: 'Montenegro',
  MY: 'Malaysia',
  ND: 'Netherlands',
  NF: 'Belgium / France / Luxembourg',
  PL: 'Poland',
  PM: 'Poland',
  PP: 'Philippines',
  QL: 'Italy / Spain',
  QN: 'Denmark / Norway / Sweden',
  RK: 'Kazakhstan',
  RM: 'Russia / Kazakhstan',
  RO: 'Romania',
  RP: 'Russia',
  RR: 'Russia',
  RS: 'Russia',
  RU: 'Russia',
  SE: 'Serbia',
  SL: 'Slovakia',
  SO: 'South Africa',
  SU: 'Ukraine',
  T: 'Italy',
  TA: 'Taiwan',
  TU: 'Turkey',
  TY: 'Italy',
  VC: 'Canada',
  X: 'Australia / New Zealand',
  Y: 'Spain',
  ZA: 'Singapore',
  ZD: 'Europe',
  ZG: 'Nordic countries',
  ZO: 'United Arab Emirates',
  ZP: 'Hong Kong / Macao',
  ZQ: 'Hong Kong',
};

/**
 * `RegionInfo` arrives as `LL/A`. Returns null for unmapped codes rather than
 * inventing a country name.
 */
export function resolveRegion(regionInfo: string | null | undefined): {
  code: string | null;
  name: string | null;
} {
  if (!regionInfo) return { code: null, name: null };
  const code = regionInfo.trim().toUpperCase().split('/')[0]?.trim() ?? '';
  if (!code) return { code: null, name: null };
  const name = REGIONS[code] ?? REGIONS[code.replace(/A$/, '')] ?? null;
  return { code: regionInfo.trim(), name };
}

export const REGION_CODES = REGIONS;
