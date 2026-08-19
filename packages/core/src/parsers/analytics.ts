import type { AnalyticsExtract } from '../capture/snapshot.js';

/**
 * Extractor for Apple's aggregated analytics files.
 *
 * These are the `log-aggregated-YYYY-MM-DD-*.ips` documents a user can see at
 * Settings > Privacy & Security > Analytics & Improvements > Analytics Data.
 * They are copied over the public `com.apple.crashreportcopymobile` service
 * (`idevicecrashreport`), which requires nothing but a trusted USB pairing.
 *
 * This is DevDNA's fallback battery source on iOS builds where the diagnostics
 * relay refuses IORegistry queries, and a signal source for the parts engine.
 *
 * Apple does not document the schema and reshapes it between releases, so the
 * extractor is deliberately tolerant: it deep-walks any JSON payload and
 * matches keys against alias sets rather than assuming a fixed path. Alias
 * tables are data, so a schema shift is a config change, not a code change.
 */

/** Canonical battery field -> key spellings observed across iOS releases. */
export const BATTERY_KEY_ALIASES: Record<string, string[]> = {
  designCapacityMah: ['DesignCapacity', 'design_capacity', 'BatteryDesignCapacity'],
  nominalChargeCapacityMah: [
    'NominalChargeCapacity',
    'nominal_charge_capacity',
    'NCC',
    'BatteryNominalChargeCapacity',
  ],
  maximumCapacityPercent: [
    'MaximumCapacityPercent',
    'maximum_capacity_percent',
    'BatteryMaxCapacity',
    'BatteryHealthMaximumCapacity',
  ],
  cycleCount: ['CycleCount', 'cycle_count', 'BatteryCycleCount'],
  batterySerial: ['BatterySerialNumber', 'battery_serial', 'Serial'],
  /** Apple's own service recommendation flag. */
  batteryHealthCondition: ['BatteryHealthCondition', 'battery_health_condition', 'HealthCondition'],
};

/**
 * Substrings that, when present in a diagnostic payload, are meaningful to the
 * parts engine. Matching is case-insensitive. Kept as data for the same reason
 * as the alias table.
 */
export const DIAGNOSTIC_STRING_PATTERNS: string[] = [
  'AppleSmartBatteryUnknownPart',
  'BatteryUnknownPart',
  'UnknownPart',
  'NonGenuineBattery',
  'DisplaySerialMismatch',
  'MultitouchCalibrationFailure',
  'TrueToneDisabled',
  'AppleDisplayPipeAuthFailure',
  'FaceIDPairingFailure',
  'PearlNotPaired',
  'CameraPairingFailure',
  'ComponentPairingFailure',
  'ServiceHistoryRecord',
];

type Json = unknown;

interface WalkHit {
  key: string;
  value: string | number | boolean;
}

function deepWalk(node: Json, visit: (hit: WalkHit) => void, depth = 0): void {
  if (depth > 24 || node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (const item of node) deepWalk(item, visit, depth + 1);
    return;
  }
  if (typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, Json>)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        visit({ key, value });
      } else {
        deepWalk(value, visit, depth + 1);
      }
    }
  }
}

/**
 * `.ips` files are usually a one-line JSON header followed by a JSON body.
 * Parse whatever parses; never throw on a malformed capture.
 */
export function parseIpsDocuments(content: string): Json[] {
  const docs: Json[] = [];
  const trimmed = content.trim();
  if (!trimmed) return docs;

  try {
    docs.push(JSON.parse(trimmed));
    return docs;
  } catch {
    // Fall through to the header + body form.
  }

  const newline = trimmed.indexOf('\n');
  if (newline > 0) {
    for (const chunk of [trimmed.slice(0, newline), trimmed.slice(newline + 1)]) {
      try {
        docs.push(JSON.parse(chunk.trim()));
      } catch {
        // Non-JSON section (some builds append plain text) — ignored here and
        // still scanned by the raw-text pass in `extractAnalytics`.
      }
    }
  }
  return docs;
}

export function extractAnalytics(
  fileName: string,
  content: string,
): AnalyticsExtract {
  const batteryKeys: Record<string, number | string | boolean> = {};
  const diagnosticStrings = new Set<string>();

  const aliasLookup = new Map<string, string>();
  for (const [canonical, aliases] of Object.entries(BATTERY_KEY_ALIASES)) {
    for (const alias of aliases) aliasLookup.set(alias.toLowerCase(), canonical);
  }

  for (const doc of parseIpsDocuments(content)) {
    deepWalk(doc, ({ key, value }) => {
      const canonical = aliasLookup.get(key.toLowerCase());
      // First occurrence wins: aggregated files list newest records first.
      if (canonical && batteryKeys[canonical] === undefined) {
        batteryKeys[canonical] = value;
      }
      if (typeof value === 'string') collectDiagnosticStrings(value, diagnosticStrings);
      collectDiagnosticStrings(key, diagnosticStrings);
    });
  }

  // Raw-text sweep catches payloads that failed to parse as JSON.
  collectDiagnosticStrings(content, diagnosticStrings);

  return {
    sourceFile: fileName,
    fileDate: /(\d{4}-\d{2}-\d{2})/.exec(fileName)?.[1] ?? null,
    batteryKeys,
    diagnosticStrings: [...diagnosticStrings],
  };
}

function collectDiagnosticStrings(haystack: string, sink: Set<string>): void {
  const lowered = haystack.toLowerCase();
  for (const pattern of DIAGNOSTIC_STRING_PATTERNS) {
    if (lowered.includes(pattern.toLowerCase())) sink.add(pattern);
  }
}

/**
 * Merge several analytics extracts, preferring the newest file for each field.
 * Input order is irrelevant; files are sorted by their embedded date.
 */
export function mergeAnalytics(extracts: AnalyticsExtract[]): AnalyticsExtract | null {
  if (extracts.length === 0) return null;
  const sorted = [...extracts].sort((a, b) => (b.fileDate ?? '').localeCompare(a.fileDate ?? ''));
  const merged: AnalyticsExtract = {
    sourceFile: sorted[0]?.sourceFile ?? '',
    fileDate: sorted[0]?.fileDate ?? null,
    batteryKeys: {},
    diagnosticStrings: [],
  };
  const strings = new Set<string>();
  for (const extract of sorted) {
    for (const [key, value] of Object.entries(extract.batteryKeys)) {
      if (merged.batteryKeys[key] === undefined) merged.batteryKeys[key] = value;
    }
    for (const s of extract.diagnosticStrings) strings.add(s);
  }
  merged.diagnosticStrings = [...strings];
  return merged;
}
