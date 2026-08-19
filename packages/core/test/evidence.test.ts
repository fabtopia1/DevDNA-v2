import { describe, expect, it } from 'vitest';
import {
  buildSimulatedSnapshot,
  collectEvidence,
  CollectionMethod,
  EvidenceKind,
  EvidenceLedger,
  EvidenceSource,
  EvidenceSubject,
  evidenceId,
  FailureReason,
} from '../src/index.js';

const at = '2026-03-14T10:24:00.000Z';

const baseRecord = {
  kind: EvidenceKind.DEVICE_PROPERTY,
  subject: EvidenceSubject.DEVICE,
  key: 'ProductType',
  value: 'iPhone16,1',
  source: EvidenceSource.DEVICE_OS,
  method: CollectionMethod.LOCKDOWN_GLOBAL_QUERY,
  collector: 'lockdown.global',
  observedAt: at,
};

describe('evidence ledger', () => {
  it('content-addresses records so the same observation yields the same id', () => {
    const a = new EvidenceLedger().record(baseRecord);
    const b = new EvidenceLedger().record({ ...baseRecord, observedAt: '2027-01-01T00:00:00.000Z' });
    // The same fact read a year apart is the same fact.
    expect(a.id).toBe(b.id);
    expect(a.id).toMatch(/^ev_[0-9a-f]{24}$/);
  });

  it('gives different ids to different values, sources or collectors', () => {
    const base = evidenceId({ ...baseRecord, provenance: baseRecord });
    expect(evidenceId({ ...baseRecord, value: 'iPhone16,2', provenance: baseRecord })).not.toBe(base);
    expect(
      evidenceId({ ...baseRecord, provenance: { ...baseRecord, source: EvidenceSource.TECHNICIAN } }),
    ).not.toBe(base);
  });

  it('deduplicates, so one fact cannot be counted twice into a score', () => {
    const ledger = new EvidenceLedger();
    ledger.record(baseRecord);
    ledger.record(baseRecord);
    ledger.record({ ...baseRecord, observedAt: '2026-04-01T00:00:00.000Z' });
    expect(ledger.size).toBe(1);
  });

  it('records collection failures as evidence rather than discarding them', () => {
    const ledger = new EvidenceLedger();
    const record = ledger.recordFailure({
      subject: EvidenceSubject.BATTERY,
      key: 'battery.ioregistry',
      reason: FailureReason.SERVICE_UNAVAILABLE,
      source: EvidenceSource.DEVICE_OS,
      method: CollectionMethod.SERVICE_PROBE,
      collector: 'battery.ioregistry',
      observedAt: at,
      detail: 'diagnostics relay declined',
    });

    expect(record.kind).toBe(EvidenceKind.COLLECTION_FAILURE);
    expect(ledger.failures(EvidenceSubject.BATTERY)).toHaveLength(1);
    // A failure is certain about the failure itself.
    expect(record.provenance.reliability).toBe(1);
  });

  it('never returns a failure record as if it were a reading', () => {
    const ledger = new EvidenceLedger();
    ledger.recordFailure({
      subject: EvidenceSubject.BATTERY,
      key: 'CycleCount',
      reason: FailureReason.SERVICE_UNAVAILABLE,
      source: EvidenceSource.DEVICE_OS,
      method: CollectionMethod.SERVICE_PROBE,
      collector: 'battery.ioregistry',
      observedAt: at,
    });
    expect(ledger.best(EvidenceSubject.BATTERY, 'CycleCount')).toBeUndefined();
    expect(ledger.number(EvidenceSubject.BATTERY, 'CycleCount')).toBeUndefined();
  });

  it('prefers the most reliable source when a fact has several', () => {
    const ledger = new EvidenceLedger();
    ledger.record({
      ...baseRecord,
      subject: EvidenceSubject.BATTERY,
      key: 'CycleCount',
      value: 412,
      source: EvidenceSource.DEVICE_ANALYTICS,
      method: CollectionMethod.CRASH_REPORT_COPY,
      collector: 'analytics.battery',
    });
    ledger.record({
      ...baseRecord,
      subject: EvidenceSubject.BATTERY,
      key: 'CycleCount',
      value: 411,
      source: EvidenceSource.DEVICE_HARDWARE_REGISTRY,
      method: CollectionMethod.DIAGNOSTICS_RELAY_IOREGISTRY,
      collector: 'battery.ioregistry',
    });

    // The registry outranks analytics, so its reading wins.
    expect(ledger.number(EvidenceSubject.BATTERY, 'CycleCount')).toBe(411);
    expect(ledger.forSubject(EvidenceSubject.BATTERY, 'CycleCount')).toHaveLength(2);
  });

  it('returns undefined rather than a default for missing facts', () => {
    const ledger = new EvidenceLedger();
    expect(ledger.string(EvidenceSubject.DEVICE, 'SerialNumber')).toBeUndefined();
    expect(ledger.number(EvidenceSubject.BATTERY, 'CycleCount')).toBeUndefined();
    expect(ledger.boolean(EvidenceSubject.SECURITY_STATE, 'IsSupervised')).toBeUndefined();
  });

  it('produces a stable digest that changes when evidence changes', () => {
    const ledger = new EvidenceLedger();
    ledger.record(baseRecord);
    const digest = ledger.digest();

    expect(EvidenceLedger.from(ledger.all()).digest()).toBe(digest);
    ledger.record({ ...baseRecord, key: 'ModelNumber', value: 'MTUW3' });
    expect(ledger.digest()).not.toBe(digest);
  });

  it('round-trips through serialisation without losing a record', () => {
    const ledger = collectEvidence(buildSimulatedSnapshot('serviced-14-pro'));
    const restored = EvidenceLedger.from(JSON.parse(JSON.stringify(ledger.all())));
    expect(restored.size).toBe(ledger.size);
    expect(restored.digest()).toBe(ledger.digest());
  });
});

describe('collectors', () => {
  it('translates a snapshot into evidence with full provenance', () => {
    const ledger = collectEvidence(buildSimulatedSnapshot('pristine-15-pro'));

    expect(ledger.string(EvidenceSubject.DEVICE, 'ProductType')).toBe('iPhone16,1');
    expect(ledger.number(EvidenceSubject.BATTERY, 'CycleCount')).toBe(42);

    for (const record of ledger.all()) {
      expect(record.provenance.source).toBeTruthy();
      expect(record.provenance.method).toBeTruthy();
      expect(record.provenance.collector).toBeTruthy();
      expect(record.provenance.observedAt).toBeTruthy();
      expect(record.provenance.reliability).toBeGreaterThan(0);
      expect(record.provenance.reliability).toBeLessThanOrEqual(1);
    }
  });

  it('carries snapshot collection errors into the ledger as failures', () => {
    const ledger = collectEvidence(buildSimulatedSnapshot('legacy-sparse-8'));
    const failures = ledger.find((r) => r.kind === EvidenceKind.COLLECTION_FAILURE);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.map((f) => f.value)).toContain(FailureReason.SERVICE_UNAVAILABLE);
  });

  it('attributes a technician attestation to the technician, not the device', () => {
    const ledger = collectEvidence(buildSimulatedSnapshot('serviced-14-pro'));
    const statements = ledger.find((r) => r.kind === EvidenceKind.SERVICE_RECORD_STATEMENT);

    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
      expect(statement.provenance.source).toBe(EvidenceSource.TECHNICIAN);
      expect(statement.provenance.method).toBe(CollectionMethod.TECHNICIAN_INPUT);
      // Second-hand evidence must not carry first-hand reliability.
      expect(statement.provenance.reliability).toBeLessThan(0.8);
    }
  });

  it('records every provenance timestamp as a full ISO instant', () => {
    // A date-only timestamp does not survive a round-trip through a database
    // timestamp column, which would silently change the ledger digest on
    // reload and make real tampering indistinguishable from a formatting
    // artefact.
    for (const profile of ['serviced-14-pro', 'counterfeit-display-13'] as const) {
      for (const record of collectEvidence(buildSimulatedSnapshot(profile)).all()) {
        expect(record.provenance.observedAt, `${profile} ${record.key}`).toMatch(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
        );
        expect(new Date(record.provenance.observedAt).toISOString()).toBe(
          record.provenance.observedAt,
        );
      }
    }
  });

  it('is deterministic: the same snapshot always yields the same ledger', () => {
    const a = collectEvidence(buildSimulatedSnapshot('counterfeit-display-13'));
    const b = collectEvidence(buildSimulatedSnapshot('counterfeit-display-13'));
    expect(a.digest()).toBe(b.digest());
  });
});
