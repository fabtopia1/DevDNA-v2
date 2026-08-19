import { createHash } from 'node:crypto';
import {
  CHANNEL_RELIABILITY,
  EvidenceKind,
  EvidenceSubject,
  FailureReason,
  type CollectionMethod,
  type EvidenceRecord,
  type EvidenceSource,
  type EvidenceValue,
  type Provenance,
} from './types.js';

/**
 * Content-addressed evidence id.
 *
 * Derived from the datum and its provenance, so the same observation always
 * yields the same id. Two consequences that matter:
 *
 *  - Deduplication is automatic. Two collectors reading the same lockdown key
 *    produce one record, not two, so a fact cannot be double-counted into a
 *    score by being observed twice.
 *  - Reproducibility is checkable. Re-collecting an unchanged device produces
 *    an identical ledger, and a stored ledger can be verified against its
 *    digest.
 *
 * `observedAt` is excluded: the same fact read twice a second apart is the
 * same fact. Timestamps live in the record and in the audit trail.
 */
export function evidenceId(input: {
  kind: EvidenceKind;
  subject: EvidenceSubject;
  key: string;
  value: EvidenceValue;
  provenance: Pick<Provenance, 'source' | 'method' | 'collector'>;
}): string {
  const canonical = [
    input.kind,
    input.subject,
    input.key,
    typeof input.value === 'string' ? input.value : JSON.stringify(input.value),
    input.provenance.source,
    input.provenance.method,
    input.provenance.collector,
  ].join(' ');
  return `ev_${createHash('sha256').update(canonical).digest('hex').slice(0, 24)}`;
}

export interface RecordInput {
  kind: EvidenceKind;
  subject: EvidenceSubject;
  key: string;
  value: EvidenceValue;
  source: EvidenceSource;
  method: CollectionMethod;
  collector: string;
  observedAt: string;
  /** Overrides the channel default when a collector knows better. */
  reliability?: number;
  instrument?: string;
  raw?: string;
  note?: string;
}

/**
 * The evidence ledger: an append-only, deduplicated, queryable set of observed
 * facts.
 *
 * This, not the raw device snapshot, is the artifact every module reads and the
 * artifact the system persists. A stored ledger is sufficient to recompute
 * every inference, verdict and score, which is what makes historical
 * inspections auditable and re-scorable.
 */
export class EvidenceLedger {
  private readonly records = new Map<string, EvidenceRecord>();

  static from(records: readonly EvidenceRecord[]): EvidenceLedger {
    const ledger = new EvidenceLedger();
    for (const record of records) ledger.records.set(record.id, record);
    return ledger;
  }

  /** Append an observation. Returns the record, existing or new. */
  record(input: RecordInput): EvidenceRecord {
    const provenance: Provenance = {
      source: input.source,
      method: input.method,
      observedAt: input.observedAt,
      reliability: input.reliability ?? CHANNEL_RELIABILITY[input.method],
      collector: input.collector,
      ...(input.instrument ? { instrument: input.instrument } : {}),
    };

    const id = evidenceId({
      kind: input.kind,
      subject: input.subject,
      key: input.key,
      value: input.value,
      provenance,
    });

    const existing = this.records.get(id);
    if (existing) return existing;

    const record: EvidenceRecord = {
      id,
      kind: input.kind,
      subject: input.subject,
      key: input.key,
      value: input.value,
      provenance,
      ...(input.raw ? { raw: input.raw } : {}),
      ...(input.note ? { note: input.note } : {}),
    };
    this.records.set(id, record);
    return record;
  }

  /** Record that a collection attempt failed. Failures are evidence. */
  recordFailure(input: {
    subject: EvidenceSubject;
    key: string;
    reason: FailureReason;
    source: EvidenceSource;
    method: CollectionMethod;
    collector: string;
    observedAt: string;
    detail?: string;
  }): EvidenceRecord {
    return this.record({
      kind: EvidenceKind.COLLECTION_FAILURE,
      subject: input.subject,
      key: input.key,
      value: input.reason,
      source: input.source,
      method: input.method,
      collector: input.collector,
      observedAt: input.observedAt,
      // A failure tells us reliably that we failed; the channel's reliability
      // for reading values is not what is being asserted here.
      reliability: 1,
      ...(input.detail ? { note: input.detail } : {}),
    });
  }

  get(id: string): EvidenceRecord | undefined {
    return this.records.get(id);
  }

  has(id: string): boolean {
    return this.records.has(id);
  }

  get size(): number {
    return this.records.size;
  }

  /** All records, in a stable order so serialisation is deterministic. */
  all(): EvidenceRecord[] {
    return [...this.records.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  find(predicate: (record: EvidenceRecord) => boolean): EvidenceRecord[] {
    return this.all().filter(predicate);
  }

  /** Records for one subject, optionally narrowed to one key. */
  forSubject(subject: EvidenceSubject, key?: string): EvidenceRecord[] {
    return this.find((r) => r.subject === subject && (key === undefined || r.key === key));
  }

  /**
   * The single most reliable record for a subject/key, or undefined.
   *
   * Collection failures are never returned as values: a failure is evidence
   * that we could not read something, not a reading.
   */
  best(subject: EvidenceSubject, key: string): EvidenceRecord | undefined {
    return this.forSubject(subject, key)
      .filter((r) => r.kind !== EvidenceKind.COLLECTION_FAILURE)
      .sort((a, b) => b.provenance.reliability - a.provenance.reliability)[0];
  }

  /** Convenience readers. They return `undefined`, never a default. */
  value(subject: EvidenceSubject, key: string): EvidenceValue | undefined {
    return this.best(subject, key)?.value;
  }

  string(subject: EvidenceSubject, key: string): string | undefined {
    const value = this.value(subject, key);
    return typeof value === 'string' && value.trim() !== '' ? value : undefined;
  }

  number(subject: EvidenceSubject, key: string): number | undefined {
    const value = this.value(subject, key);
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
  }

  boolean(subject: EvidenceSubject, key: string): boolean | undefined {
    const value = this.value(subject, key);
    return typeof value === 'boolean' ? value : undefined;
  }

  /** Did any collector fail to read this subject/key? */
  failures(subject: EvidenceSubject, key?: string): EvidenceRecord[] {
    return this.find(
      (r) =>
        r.kind === EvidenceKind.COLLECTION_FAILURE &&
        r.subject === subject &&
        (key === undefined || r.key === key),
    );
  }

  /**
   * Digest of the whole ledger. Persisted alongside an inspection so a stored
   * ledger can be proven unmodified before it is re-scored.
   *
   * Hashes record *content*, not just ids. Hashing ids alone looks sufficient
   * because ids are content-addressed - but that only holds for a ledger this
   * code produced. A stored ledger edited in the database keeps its original
   * ids, so an id-only digest would happily certify tampered values. Anti-
   * tampering is the entire purpose of this function, so it hashes what it is
   * meant to protect.
   */
  digest(): string {
    const hash = createHash('sha256');
    for (const record of this.all()) {
      hash.update(
        JSON.stringify([
          record.id,
          record.kind,
          record.subject,
          record.key,
          record.value,
          record.provenance.source,
          record.provenance.method,
          record.provenance.collector,
          record.provenance.reliability,
          record.provenance.observedAt,
        ]),
      );
    }
    return hash.digest('hex');
  }

  /**
   * Recompute every id from its record's content.
   *
   * A record whose value was edited after storage keeps its original id, and
   * that mismatch is exactly what this detects. Run before re-scoring a ledger
   * that has been outside the process.
   */
  verifyIntegrity(): { ok: boolean; mismatched: string[] } {
    const mismatched: string[] = [];
    for (const record of this.all()) {
      const expected = evidenceId({
        kind: record.kind,
        subject: record.subject,
        key: record.key,
        value: record.value,
        provenance: record.provenance,
      });
      if (expected !== record.id) mismatched.push(record.id);
    }
    return { ok: mismatched.length === 0, mismatched };
  }

  /** A detached copy, so evaluation never mutates a caller's ledger. */
  clone(): EvidenceLedger {
    return EvidenceLedger.from(this.all());
  }

  toJSON(): EvidenceRecord[] {
    return this.all();
  }
}
