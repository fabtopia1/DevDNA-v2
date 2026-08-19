import { DataSource, Severity, type Finding } from '../types/common.js';
import type { RawDeviceSnapshot } from '../types/device.js';
import type { InspectionResult } from '../types/inspection.js';
import { assessIdentity } from './identity.js';
import { assessBattery } from './battery.js';
import { assessSoftware } from './software.js';
import { assessParts, type PartsEngineOptions } from './parts/index.js';
import { assessTrust, trustFindings } from './trust.js';

/**
 * Version of the whole engine bundle. Persisted with every inspection so a
 * historical report can always be explained by the code that produced it, and
 * so a stored snapshot can be deliberately re-scored under a newer engine.
 */
export const ENGINE_VERSION = '1.0.0';

const SEVERITY_ORDER: Record<Severity, number> = {
  [Severity.CRITICAL]: 0,
  [Severity.HIGH]: 1,
  [Severity.MEDIUM]: 2,
  [Severity.LOW]: 3,
  [Severity.INFO]: 4,
};

export interface InspectionOptions {
  udidSalt?: string;
  parts?: PartsEngineOptions;
  /** Overrides `snapshot.capturedAt` as the inspection timestamp. */
  inspectedAt?: string;
}

/**
 * Run the full SoftwareDNA inspection over a raw snapshot.
 *
 * Pure and synchronous by design: the same snapshot always produces the same
 * result under the same engine version, which is what makes an inspection
 * auditable and re-scorable.
 */
export function runInspection(
  snapshot: RawDeviceSnapshot,
  options: InspectionOptions = {},
): InspectionResult {
  const { identity } = assessIdentity(snapshot, { udidSalt: options.udidSalt ?? '' });
  const battery = assessBattery(snapshot);
  const software = assessSoftware(snapshot);
  const parts = assessParts(snapshot, options.parts ?? {});
  const trust = assessTrust({ identity, battery, software, parts });

  const collectionFindings: Finding[] = snapshot.errors.map((error) => ({
    code: `COLLECTION_${error.code}`,
    severity: Severity.LOW,
    title: `Collector ${error.collector} could not complete`,
    detail: error.message,
    source: DataSource.DERIVED,
  }));

  const findings = dedupeFindings([
    ...trustFindings(trust, { identity, battery, software, parts }),
    ...parts.findings,
    ...battery.findings,
    ...software.findings,
    ...collectionFindings,
  ]);

  return {
    engineVersion: ENGINE_VERSION,
    inspectedAt: options.inspectedAt ?? snapshot.capturedAt,
    identity,
    battery,
    software,
    parts,
    trust,
    findings,
  };
}

function dedupeFindings(findings: Finding[]): Finding[] {
  const seen = new Map<string, Finding>();
  for (const finding of findings) {
    if (!seen.has(finding.code)) seen.set(finding.code, finding);
  }
  return [...seen.values()].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
}
