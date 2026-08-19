import { parsePlistDict, type PlistValue } from './plist.js';

/**
 * `ideviceinfo` emits either an XML plist (`-x`) or `Key: Value` lines. The
 * bridge always requests XML, but shops sometimes paste plain-text captures
 * into support tickets, so both are accepted.
 */
export function parseIdeviceInfo(output: string): Record<string, PlistValue> {
  const text = output.trim();
  if (!text) return {};
  if (text.startsWith('<?xml') || text.startsWith('<plist') || text.startsWith('<dict')) {
    return parsePlistDict(text);
  }
  return parseKeyValueLines(text);
}

/** `Key: Value` fallback parser, tolerant of blank lines and tool banners. */
export function parseKeyValueLines(output: string): Record<string, PlistValue> {
  const result: Record<string, PlistValue> = {};
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf(':');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const raw = trimmed.slice(idx + 1).trim();
    result[key] = coerceScalar(raw);
  }
  return result;
}

function coerceScalar(raw: string): PlistValue {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === '') return '';
  if (/^-?\d+$/.test(raw)) {
    const asNumber = Number.parseInt(raw, 10);
    // Values beyond the safe integer range (e.g. some capacity fields) stay
    // strings rather than silently losing precision.
    return Number.isSafeInteger(asNumber) ? asNumber : raw;
  }
  if (/^-?\d+\.\d+$/.test(raw)) return Number.parseFloat(raw);
  return raw;
}

/** Case-insensitive lookup across several candidate key spellings. */
export function pick(source: Record<string, unknown> | null | undefined, ...keys: string[]): unknown {
  if (!source) return undefined;
  for (const key of keys) {
    if (key in source) return source[key];
  }
  const lowered = new Map(Object.keys(source).map((k) => [k.toLowerCase(), k]));
  for (const key of keys) {
    const actual = lowered.get(key.toLowerCase());
    if (actual !== undefined) return source[actual];
  }
  return undefined;
}

export function asString(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() === '' ? null : value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

export function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function asBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (['true', 'yes', '1', 'on'].includes(v)) return true;
    if (['false', 'no', '0', 'off'].includes(v)) return false;
  }
  return null;
}
