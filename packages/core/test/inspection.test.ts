import { describe, expect, it } from 'vitest';
import {
  buildSimulatedSnapshot,
  ENGINE_VERSION,
  hashIdentifier,
  runInspection,
  Severity,
  SIMULATOR_PROFILES,
  signPayload,
  VerificationStatus,
  verifySignature,
} from '../src/index.js';

describe('end-to-end inspection', () => {
  it('produces a complete, deterministic result for every simulator profile', () => {
    for (const profile of SIMULATOR_PROFILES) {
      const snapshot = profile.build();
      const first = runInspection(snapshot);
      const second = runInspection(profile.build());
      expect(second).toEqual(first);
      expect(first.engineVersion).toBe(ENGINE_VERSION);
      expect(first.identity.productType).not.toBe('');
      expect(first.trust.score).toBeGreaterThanOrEqual(0);
      expect(first.trust.score).toBeLessThanOrEqual(100);
    }
  });

  it('classifies each profile the way a trade buyer would expect', () => {
    expect(runInspection(buildSimulatedSnapshot('pristine-15-pro')).trust.status).toBe(
      VerificationStatus.VERIFIED,
    );
    expect(runInspection(buildSimulatedSnapshot('counterfeit-display-13')).trust.status).toBe(
      VerificationStatus.FLAGGED,
    );
    expect(runInspection(buildSimulatedSnapshot('activation-locked-12')).trust.status).toBe(
      VerificationStatus.FLAGGED,
    );
    expect(runInspection(buildSimulatedSnapshot('legacy-sparse-8')).trust.status).toBe(
      VerificationStatus.INCONCLUSIVE,
    );

    // A device with disclosed Apple service should still trade, with notes.
    const serviced = runInspection(buildSimulatedSnapshot('serviced-14-pro'));
    expect([VerificationStatus.VERIFIED, VerificationStatus.VERIFIED_WITH_NOTES]).toContain(
      serviced.trust.status,
    );
    expect(serviced.findings.map((f) => f.code)).toContain('PART_USED_BATTERY');
  });

  it('resolves identity fields a report needs', () => {
    const result = runInspection(buildSimulatedSnapshot('pristine-15-pro'));
    expect(result.identity.marketingName).toBe('iPhone 15 Pro');
    expect(result.identity.marketingCapacityGb).toBe(256);
    expect(result.identity.regionName).toBe('United States');
    expect(result.identity.iosVersion).toBe('18.3.1');
    expect(result.identity.recognisedModel).toBe(true);
  });

  it('sorts findings with the most severe first', () => {
    const result = runInspection(buildSimulatedSnapshot('counterfeit-display-13'));
    const order = [Severity.CRITICAL, Severity.HIGH, Severity.MEDIUM, Severity.LOW, Severity.INFO];
    const indices = result.findings.map((f) => order.indexOf(f.severity));
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    expect(result.findings.length).toBeGreaterThan(0);
  });

  it('emits no duplicate finding codes', () => {
    for (const profile of SIMULATOR_PROFILES) {
      const codes = runInspection(profile.build()).findings.map((f) => f.code);
      expect(new Set(codes).size).toBe(codes.length);
    }
  });

  it('surfaces collector failures as findings rather than swallowing them', () => {
    const result = runInspection(buildSimulatedSnapshot('legacy-sparse-8'));
    expect(result.findings.map((f) => f.code)).toContain('COLLECTION_SERVICE_UNAVAILABLE');
  });

  it('salts UDID hashes so the same device is not linkable across tenants', () => {
    const snapshot = buildSimulatedSnapshot('pristine-15-pro');
    const a = runInspection(snapshot, { udidSalt: 'tenant-a' }).identity.udidHash;
    const b = runInspection(snapshot, { udidSalt: 'tenant-b' }).identity.udidHash;
    expect(a).not.toBe(b);
    expect(a).toHaveLength(64);
    expect(hashIdentifier('X', 'tenant-a')).toBe(hashIdentifier('x', 'tenant-a'));
  });
});

describe('bridge request signing', () => {
  it('round-trips and rejects tampering in constant time', () => {
    const canonical = 'POST\n/v1/inspections\n1710412800\nabc123';
    const sig = signPayload('shared-secret', canonical);
    expect(verifySignature('shared-secret', canonical, sig)).toBe(true);
    expect(verifySignature('other-secret', canonical, sig)).toBe(false);
    expect(verifySignature('shared-secret', `${canonical}x`, sig)).toBe(false);
    expect(verifySignature('shared-secret', canonical, '')).toBe(false);
  });
});
