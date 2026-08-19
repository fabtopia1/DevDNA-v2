# 7. Database schema

PostgreSQL 16, Prisma 6. Full definition: `apps/api/prisma/schema.prisma`.

Two principles drive the whole schema:

1. **Multi-tenancy is structural.** Every row a shop can read carries an
   `organizationId`, and every query path filters on it. Repair shops compete
   with each other and trade the same stock; a cross-tenant leak of device
   history is an existential product failure, not a bug.
2. **Evidence and conclusions live in different tables.** The evidence can be
   re-scored without the conclusions being in the way, and a conclusion can
   always be traced back to rows in `evidence_records`.

## Layout

```
organizations ─┬─ users ─── refresh_tokens
               ├─ bridge_registrations ─── bridge_nonces
               ├─ customers
               ├─ api_keys
               ├─ audit_logs
               ├─ devices ─────────────┐
               └─ inspections ─────────┘
                        │
       ┌────────────────┼──────────────────┬──────────────┬──────────┐
       ▼                ▼                  ▼              ▼          ▼
 evidence_records   inferences      module_verdicts   findings   audit_entries
       │                                    │
       └──── component_service_results ─────┘        reports
```

## The evidence tables

### `evidence_records` — facts

| Column | Notes |
|---|---|
| `evidenceId` | the engine's content-addressed `ev_…` id |
| `kind`, `subject`, `key` | what the datum is about |
| `value` `Json` | **preserved with its original type**, not stringified |
| `sourceAuthority`, `method`, `collector`, `observedAt`, `reliability`, `instrument` | provenance, required on every row |
| `raw`, `note` | verbatim excerpt and human restatement |

```prisma
@@unique([inspectionId, evidenceId])
@@index([inspectionId, subject])
@@index([key])
@@index([sourceAuthority, method])
```

`value` is `Json` rather than `String` because re-scoring must reproduce the
original result exactly, and `412` re-read as `"412"` does not. `observedAt` is
a full ISO instant for the same reason — an early bug stored date-only
timestamps from analytics files, and the timestamp changed shape on the round
trip, which changed the ledger digest.

The indexes are chosen for the questions a refurbisher actually asks. *"Every
device this month where the diagnostics relay refused"* should be plain SQL, not
a JSON traversal, which is why evidence is rows rather than a blob inside the
report.

Identifying values (serial, IMEI, UDID) are stored as
`{ "__enc": "<AES-256-GCM ciphertext>" }` unless the organization has opted in
to plaintext retention. Encryption rather than redaction, because redaction
breaks both re-scoring and the digest; masking happens at API egress.

### `inferences` — claims

`inferenceId`, `module`, `rule`, `subject`, `direction`, `statement`, `weight`,
`confidence`, `evidenceIds String[]`, `derivedAt`. `evidenceIds` is never empty
— the engine cannot construct one that is.

Indexed on `(inspectionId, module)` and on `rule`, so *"how often did
`service.listed-in-service-history` fire last quarter"* is answerable.

### `module_verdicts` — conclusions

`verdictId`, `module`, `subject`, `value`, `determinacy`, `confidence`,
`rationale`, `inferenceIds String[]`, `evidenceIds String[]`.

`value` is a plain `String`, not an enum. Each module has its own vocabulary and
they must be able to evolve independently; a shared enum would force a migration
on every module whenever one of them gained a verdict value. `determinacy` *is*
an enum, because `DETERMINED | INDETERMINATE` is universal.

Indexed on `(module, value)` for fleet queries.

### `component_service_results` — denormalised service outcomes

`subject`, `verdict` (`ServiceVerdict`), `authenticity` (`PartAuthenticity`),
`confidence`, `rationale`.

Replacement and authenticity are **separate columns** because they are separate
facts. *"How many third-party displays did we see this month"* is
`WHERE subject='DISPLAY' AND authenticity='NOT_VERIFIED'`; *"how many serviced
displays"* is `WHERE subject='DISPLAY' AND verdict='REPLACED_LIKELY'`. Those are
different numbers, and a schema that conflated them would make the second
question unanswerable.

Indexed on `(subject, verdict)` and `(subject, authenticity)`.

### `audit_entries` — the reasoning trail

`sequence`, `at`, `module`, `action`, `summary`, `refs Json`, with
`@@unique([inspectionId, sequence])` enforcing that the trail is a strict order
with no gaps or duplicates.

### `findings` — surfaced concerns

`code`, `severity`, `module`, `title`, `detail`, `basis` (`EVIDENCE | ABSENCE`),
`evidenceIds`, `inferenceIds`. See
[06-audit-model.md](06-audit-model.md#findings-and-the-basis-field) for why
`basis` exists.

## `inspections`

Carries the conclusions and the summary fields queries need — never the
evidence.

```prisma
trustVerdict TrustVerdict
trustScore   Int
rawTrustScore Int      // before gates: shows what the caps cost
confidence   Float
coverage     Float     // reported separately, never merged into confidence

identityVerdict / hardwareVerdict / securityVerdict / batteryVerdict  String?

batteryHealthPercent / batteryCycleCount / batteryWearGrade /
batteryReplacementRisk / securityPostureScore / hardwareAnomalyCount /
componentsReplacedCount / componentsIndeterminate / iosVersion /
buildVersion / unitProvenance

engineVersion / algorithmVersion / ledgerDigest
snapshot Json   // verbatim bridge capture, forensic only
report   Json   // module details as rendered at inspection time
```

`componentsIndeterminate` is stored next to `componentsReplacedCount` on
purpose: a list view that showed only replacements would make a barely-assessed
device look clean.

`snapshot` is kept for forensic re-collection, but **re-scoring reads the
ledger, not the snapshot**. Two different artifacts with two different jobs.

## `devices`

Identified by `udidHash`, not by UDID. The hash is salted with a per-tenant
`identifierSalt` on `organizations` — without it the same handset would hash
identically across tenants, letting one shop confirm another shop had handled a
specific device. Raw `udid`/`serialNumber` columns exist but are populated only
under explicit opt-in.

`@@unique([organizationId, udidHash])` gives one device row per handset per
tenant, and the device history that makes a second inspection more valuable than
the first.

## Bridges

`bridge_registrations` stores the pairing token as a hash but the HMAC secret as
**ciphertext**, because a signature can only be verified against the secret
itself. A database leak alone therefore does not yield forgeable bridge
credentials — the application key is needed too. `bridge_nonces`
(`@@unique([bridgeId, nonce])`, swept on `expiresAt`) gives replay protection.

## Reports and operational audit

`reports` holds `publicId` (the unguessable id in the QR code), `storageKey`,
`checksum`, `sizeBytes`, `downloadCount`. `audit_logs` holds actor, action,
entity, IP, user agent, and metadata, indexed on `(organizationId, createdAt)`
and `action`.

## Retention

Evidence is the artifact of record, so the default is to keep it. Deleting an
`Organization` cascades to everything beneath it, which is how a tenant
offboards. Individual inspections are not deletable through the API: an
inspection underwrites a commercial decision, and a shop able to erase the
unflattering ones would hollow out the whole trust claim.
