import type { Finding, MaybeObservation } from './common.js';

export interface SoftwareAssessment {
  iosVersion: string | null;
  buildVersion: string | null;
  /** Newest release known to the catalog for this device's major train. */
  latestKnownVersion: string | null;
  /** How many major iOS versions behind the newest supported release. */
  majorVersionsBehind: number | null;
  storage: {
    totalBytes: number | null;
    availableBytes: number | null;
    usedPercent: number | null;
  };
  uptimeSeconds: MaybeObservation<number>;
  /** Reachability of the diagnostics relay — gates battery fidelity. */
  diagnosticsAvailable: boolean;
  developerModeEnabled: boolean | null;
  /** Integrity heuristics: afc2 service, known jailbreak bundle IDs. */
  jailbreakIndicators: string[];
  jailbreakSuspected: boolean;
  score: number;
  confidence: number;
  findings: Finding[];
}
