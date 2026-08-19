/**
 * Newest publicly released build per major iOS train that DevDNA knows about.
 * Used to compute "how far behind" a device is. Refreshed by the catalog sync
 * job (see `docs/06-softwaredna-engine.md`); an unknown-newer version on the
 * device is treated as up to date rather than as an anomaly.
 */
export interface IosTrain {
  major: number;
  latestVersion: string;
  /** Set once Apple stops shipping security updates for the train. */
  securityUpdatesEnded: boolean;
}

export const IOS_TRAINS: IosTrain[] = [
  { major: 12, latestVersion: '12.5.7', securityUpdatesEnded: true },
  { major: 13, latestVersion: '13.7', securityUpdatesEnded: true },
  { major: 14, latestVersion: '14.8.1', securityUpdatesEnded: true },
  { major: 15, latestVersion: '15.8.4', securityUpdatesEnded: false },
  { major: 16, latestVersion: '16.7.11', securityUpdatesEnded: false },
  { major: 17, latestVersion: '17.7.4', securityUpdatesEnded: false },
  { major: 18, latestVersion: '18.3.1', securityUpdatesEnded: false },
];

export const NEWEST_MAJOR = IOS_TRAINS.reduce((max, t) => Math.max(max, t.major), 0);

export function parseVersion(version: string | null | undefined): number[] | null {
  if (!version) return null;
  const parts = version.trim().split('.').map((p) => Number.parseInt(p, 10));
  if (parts.length === 0 || parts.some((p) => !Number.isFinite(p))) return null;
  return parts;
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a) ?? [];
  const pb = parseVersion(b) ?? [];
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

export function trainFor(major: number): IosTrain | null {
  return IOS_TRAINS.find((t) => t.major === major) ?? null;
}
