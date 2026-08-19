# 3. Evidence model

Evidence is the artifact. Scores are derived, disposable, and re-computable;
evidence is what DevDNA actually owns.

## What counts as evidence

A record is admitted only if it is something a named channel *observed*. Nine
kinds cover everything the system takes in:

| Kind | Example | Typical source |
|---|---|---|
| `DEVICE_PROPERTY` | `ProductType = iPhone15,3` | lockdown |
| `CAPABILITY_FLAG` | `TrueToneSupported = true` | lockdown domain query |
| `MEASUREMENT` | `CycleCount = 412` | `com.apple.mobile.battery` |
| `SERVICE_RECORD_STATEMENT` | `DISPLAY ServiceHistoryLabel = "Genuine Apple Part"` | technician attestation, later GSX |
| `DIAGNOSTIC_EVENT` | a panic string naming a component | crash report copy |
| `SOFTWARE_INVENTORY` | `JailbreakBundlePresent = com.saurik.Cydia` | installation proxy |
| `SERVICE_AVAILABILITY` | which lockdown services the device advertised | service probe |
| `HUMAN_ATTESTATION` | what a technician read on the device screen | technician input |
| `EXTERNAL_RECORD` | an authority's statement, through an adapter | adapter query |
| `COLLECTION_FAILURE` | `BatteryHealth` could not be read: `DEVICE_LOCKED` | any |

### Failures are evidence

`COLLECTION_FAILURE` is the kind that makes the rest of the model honest. When
the diagnostics relay refuses, DevDNA records *that*, with a `FailureReason`:

```
SERVICE_UNAVAILABLE · PERMISSION_DENIED · NOT_PAIRED · DEVICE_LOCKED
TIMEOUT · UNSUPPORTED_OS · TOOL_MISSING · PARSE_ERROR · NOT_ATTEMPTED · UNKNOWN
```

A verdict that abstained without recording why is indistinguishable from one
that never looked. Failure records are what let a report say *"we asked, the
device was locked"*, and they are shown in the evidence drawer rather than
filtered out of it.

`ledger.best()` will never return a failure as a value. A failure is evidence
that something could not be read — not a reading.

## Content addressing

```
id = 'ev_' + sha256(kind, subject, key, value, source, method, collector)[0..24]
```

`observedAt` is deliberately **excluded**. The same observation from the same
channel is the same record whether it was taken at nine o'clock or at noon,
which gives free deduplication when two collectors read the same property, and
makes the reproducibility claim checkable: re-collecting an unchanged device
produces a byte-identical ledger.

## Provenance is not optional

Every record carries `{ source, method, observedAt, reliability, collector,
instrument? }`. There is no code path that produces a record without it —
`EvidenceLedger.record()` requires it structurally, and the Provenance Engine
reads `reliability` off it when deriving anything.

**Reliability is a property of the channel, not of the value.** A perfectly
read number from a channel known to go stale still carries the channel's
reliability:

| Method | Reliability | Why |
|---|---|---|
| `EXTERNAL_ADAPTER_QUERY` | 0.99 | an authority's own record |
| `LOCKDOWN_GLOBAL_QUERY` | 0.97 | the OS reporting on itself over a paired session |
| `LOCKDOWN_DOMAIN_QUERY` | 0.95 | same channel, domain-scoped |
| `CATALOG_LOOKUP` | 0.95 | DevDNA's own published specification data |
| `DIAGNOSTICS_RELAY_IOREGISTRY` | 0.92 | live registry, but shape varies by iOS train |
| `INSTALLATION_PROXY_LIST` | 0.90 | accurate, but only about what is installed |
| `SERVICE_PROBE` | 0.85 | availability implies capability, not state |
| `CRASH_REPORT_COPY` | 0.72 | analytics can be stale, partial, or erased |
| `TECHNICIAN_INPUT` | 0.70 | honest, transcribed, and occasionally wrong |
| `OCR_EXTRACTION` | 0.60 | a photograph of a screen |

These numbers are conservative on purpose. An over-confident channel silently
inflates every downstream verdict resting on it, and nothing in the report
would show it happening.

## The ledger

```ts
class EvidenceLedger {
  record(input): EvidenceRecord          // dedupes by content-addressed id
  recordFailure(input): EvidenceRecord
  get(id) / has(id)
  best(subject, key)                     // highest reliability, never a failure
  string|number|boolean(subject, key)    // undefined, never a default
  forSubject(subject, key?)              // every record, including failures
  failures(subject, key?)
  digest(): string
  verifyIntegrity(): { ok, mismatched[] }
  clone(): EvidenceLedger
}
```

Two accessor decisions are load-bearing:

- **No defaults, ever.** `ledger.number(BATTERY, 'CycleCount')` returns
  `undefined` when unread. A default of `0` would silently become a conclusion.
- **`best()` picks by reliability, not recency.** When lockdown and a crash log
  disagree about the same key, the more reliable channel wins the *value* — and
  the disagreement itself is still visible to any rule that wants both.

## Integrity

```ts
digest(): string     // sha256 over every record's CONTENT, in order
verifyIntegrity()    // recompute each id from its content; report mismatches
```

The digest hashes content — not ids — because hashing ids only proves the *set*
is unchanged, not the values. `verifyIntegrity()` recomputes each
content-addressed id from the stored fields, so a value edited directly in the
database no longer matches its own id.

The API calls both before re-scoring, and refuses to re-score a ledger that
fails either check. A tampered ledger produces an error, not a new score.

## Separation of evidence from conclusion

This is enforced in four places, so that no single lapse can collapse it:

1. **Types.** `EvidenceRecord` has no verdict, score, or confidence field.
2. **Construction.** Inferences are only creatable through
   `ProvenanceEngine.derive()`, which requires evidence ids that resolve.
3. **Storage.** `evidence_records` is its own table, not a JSON blob inside the
   report. Conclusions live in `inferences`, `module_verdicts`, `findings`.
4. **Transport.** `GET /v1/inspections/:id` returns conclusions;
   `GET /v1/inspections/:id/evidence` returns evidence. A caller can read
   either without the other.

## Raw evidence preservation

`raw` holds the verbatim excerpt behind a record — the IORegistry line, the
analytics field, the plist value. It is never parsed downstream; it exists so
that a disputed reading can be re-examined against what the device actually
said, and so a future engine can re-derive from source text a current rule
ignores.

Identifying values (serial, IMEI, UDID) are encrypted at rest with AES-256-GCM
rather than redacted. Redaction would break both re-scoring and the digest;
encryption preserves the exact bytes, and masking happens at API egress.
