import type { EvidenceLedger, RecordInput } from '../evidence/ledger.js';
import {
  CollectionMethod,
  EvidenceSource,
  FailureReason,
  type EvidenceSubject,
} from '../evidence/types.js';

/**
 * External evidence adapters.
 *
 * The whole point of the evidence architecture is that this interface can grow
 * without anything downstream changing. An adapter's only job is to produce
 * evidence records; modules read the ledger and never learn where a record came
 * from beyond its provenance.
 *
 * So integrating GSX, an AASP portal, an IRP feed, an OEM API or a repair
 * network is:
 *
 *   1. implement `ExternalEvidenceAdapter`;
 *   2. register it;
 *   3. nothing else.
 *
 * Concretely, when a GSX adapter arrives it emits `SERVICE_RECORD_STATEMENT`
 * records for the same subjects and keys a technician attestation already
 * emits, with `EvidenceSource.OEM_SERVICE_API` and a reliability of 0.99. The
 * Service Evidence Engine's rules fire unchanged, the corroboration model
 * treats it as an independent source and raises confidence automatically, and
 * the verdict vocabulary does not move.
 *
 * DevDNA ships **no** adapter that requires a commercial agreement. The MVP is
 * deliberately whole without one.
 */

export enum AdapterCapability {
  /** Can state whether a component was serviced, and with what. */
  SERVICE_HISTORY = 'SERVICE_HISTORY',
  /** Can confirm warranty or coverage status. */
  COVERAGE_STATUS = 'COVERAGE_STATUS',
  /** Can confirm the device is reported lost or stolen. */
  LOSS_STATUS = 'LOSS_STATUS',
  /** Can confirm original configuration as built. */
  FACTORY_CONFIGURATION = 'FACTORY_CONFIGURATION',
  /** Can confirm activation lock status out of band. */
  ACTIVATION_STATUS = 'ACTIVATION_STATUS',
}

/**
 * What an adapter is asked about.
 *
 * Identifiers are optional because a given authority accepts different ones and
 * an operator may be unwilling to release a serial to a third party. An adapter
 * must degrade rather than fail when its preferred identifier is withheld.
 */
export interface AdapterQuery {
  serialNumber?: string;
  imei?: string;
  productType?: string;
  /** Restricts the query to these subjects when the adapter supports scoping. */
  subjects?: EvidenceSubject[];
  /** ISO-8601, stamped onto every record the adapter returns. */
  observedAt: string;
}

/** Evidence an adapter wishes to append, minus the provenance it cannot set. */
export type AdapterEvidence = Omit<
  RecordInput,
  'source' | 'method' | 'collector' | 'observedAt' | 'instrument'
> & {
  /** Overrides the adapter's default reliability for a specific record. */
  reliability?: number;
};

export interface AdapterResult {
  ok: boolean;
  evidence: AdapterEvidence[];
  /** Populated when the authority could not answer. Recorded as evidence too. */
  failure?: { reason: FailureReason; detail: string };
}

export interface ExternalEvidenceAdapter {
  /** Stable identifier, used as the collector name on every record. */
  readonly id: string;
  /** The authority this adapter speaks for. */
  readonly authority: EvidenceSource;
  readonly capabilities: readonly AdapterCapability[];
  /** Default channel reliability for records this adapter produces. */
  readonly reliability: number;
  /** Cheap check so the registry can skip an adapter it cannot use. */
  supports(query: AdapterQuery): boolean;
  fetch(query: AdapterQuery): Promise<AdapterResult>;
}

/**
 * Runs registered adapters and folds their answers into the ledger.
 *
 * An adapter that throws, times out or refuses is recorded as a collection
 * failure rather than being allowed to fail the inspection. An external
 * authority being unreachable is a coverage gap, not an error state, and the
 * report should say which authority was unavailable.
 */
export class AdapterRegistry {
  private readonly adapters: ExternalEvidenceAdapter[] = [];

  register(adapter: ExternalEvidenceAdapter): this {
    this.adapters.push(adapter);
    return this;
  }

  list(): readonly ExternalEvidenceAdapter[] {
    return [...this.adapters];
  }

  async enrich(
    ledger: EvidenceLedger,
    query: AdapterQuery,
    options: { timeoutMs?: number } = {},
  ): Promise<{ adapter: string; ok: boolean; recordCount: number }[]> {
    const timeoutMs = options.timeoutMs ?? 10_000;
    const outcomes: { adapter: string; ok: boolean; recordCount: number }[] = [];

    for (const adapter of this.adapters) {
      if (!adapter.supports(query)) {
        outcomes.push({ adapter: adapter.id, ok: false, recordCount: 0 });
        continue;
      }

      let result: AdapterResult;
      try {
        result = await withTimeout(adapter.fetch(query), timeoutMs);
      } catch (error) {
        ledger.recordFailure({
          subject: query.subjects?.[0] ?? ('DEVICE' as EvidenceSubject),
          key: adapter.id,
          reason: error instanceof TimeoutError ? FailureReason.TIMEOUT : FailureReason.UNKNOWN,
          source: adapter.authority,
          method: CollectionMethod.EXTERNAL_ADAPTER_QUERY,
          collector: adapter.id,
          observedAt: query.observedAt,
          detail: error instanceof Error ? error.message : String(error),
        });
        outcomes.push({ adapter: adapter.id, ok: false, recordCount: 0 });
        continue;
      }

      if (!result.ok && result.failure) {
        ledger.recordFailure({
          subject: query.subjects?.[0] ?? ('DEVICE' as EvidenceSubject),
          key: adapter.id,
          reason: result.failure.reason,
          source: adapter.authority,
          method: CollectionMethod.EXTERNAL_ADAPTER_QUERY,
          collector: adapter.id,
          observedAt: query.observedAt,
          detail: result.failure.detail,
        });
      }

      for (const evidence of result.evidence) {
        ledger.record({
          ...evidence,
          source: adapter.authority,
          method: CollectionMethod.EXTERNAL_ADAPTER_QUERY,
          collector: adapter.id,
          observedAt: query.observedAt,
          reliability: evidence.reliability ?? adapter.reliability,
        });
      }

      outcomes.push({ adapter: adapter.id, ok: result.ok, recordCount: result.evidence.length });
    }

    return outcomes;
  }
}

class TimeoutError extends Error {
  constructor() {
    super('Adapter timed out');
    this.name = 'TimeoutError';
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new TimeoutError()), ms)),
  ]);
}

export { EvidenceSource, CollectionMethod, FailureReason };
