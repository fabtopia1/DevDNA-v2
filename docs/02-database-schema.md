# 2. Database schema

PostgreSQL 16 via Prisma. Full definition: `apps/api/prisma/schema.prisma`.

Two principles drive it:

1. **Multi-tenancy is structural.** Every row a shop can read carries an
   `organizationId`, and every query path filters on it. Repair shops compete
   with each other and trade the same stock; a cross-tenant leak of device
   history is an existential product failure, not a bug.
2. **Inspections are immutable evidence.** The raw snapshot is stored verbatim
   alongside the scored result and the engine version that produced it, so any
   historical report can be explained, re-scored, or defended in a dispute.

## Tables

### `organizations`
Tenant root. `identifierSalt` is the load-bearing column: a per-tenant salt for
hashing UDIDs and serials. Without it the same handset would hash identically
across tenants, letting one shop confirm another shop handled a specific device.

| Column | Type | Notes |
|---|---|---|
| `id` | cuid | PK |
| `name`, `slug` | text | `slug` unique |
| `plan` | text | `trial` / `pro` / `enterprise` |
| `identifierSalt` | text | per-tenant hashing salt |
| `logoUrl` | text? | branded PDF reports |

### `users`
`email` globally unique, `passwordHash` Argon2id. Roles: `OWNER > ADMIN >
TECHNICIAN > VIEWER`, enforced by rank in `RolesGuard`.

### `refresh_tokens`
Stored **hashed** and individually revocable, so signing out one shop laptop
does not require rotating a tenant's secrets. Rotated on every use; a replayed
token is a strong theft signal and the revoked row makes it detectable.

### `bridge_registrations`
One physical workstation.

| Column | Notes |
|---|---|
| `tokenHash` | unique. Only ever compared, so hashed. |
| `secretCiphertext` | AES-256-GCM. Must be recoverable to verify an HMAC, so encrypted rather than hashed. |
| `lastSeenAt` | drives the online indicator |
| `revokedAt` | soft revocation preserves the audit trail |

### `bridge_nonces`
Replay protection. `@@unique([bridgeId, nonce])` makes replay rejection atomic
under concurrency rather than a check-then-act race. Rows are short-lived and
swept by a scheduled job (`BridgesService.pruneNonces`).

### `devices`
A handset, identified by `udidHash` — **not** its raw UDID.
`@@unique([organizationId, udidHash])` gives idempotent upsert on re-inspection
and puts tenant scoping in the key itself. `udid`/`serialNumber` columns exist
but stay null unless the operator sets `RETAIN_PLAINTEXT_IDENTIFIERS`.

### `inspections`
The core record.

- Scores denormalised into columns (`trustScore`, `batteryScore`, …) so list
  filtering and dashboard aggregation are plain indexed SQL.
- `snapshot` (Json) — the verbatim bridge capture, enabling re-scoring.
- `result` (Json) — the scored output exactly as the technician saw it.
- `engineVersion` + `algorithmVersion` — reproducibility.
- Indexes: `(organizationId, createdAt)`, `(organizationId, verificationStatus)`,
  `(deviceId, createdAt)`.

### `part_results`
Per-component verdicts denormalised out of `result` so fleet analytics —
*"how many third-party displays did we see this month"* — are plain SQL rather
than JSON traversal. Indexed on `(component, verdict)`.

### `findings`
Machine-readable findings, indexed on `code` for the dashboard's top-findings
aggregation.

### `reports`
| Column | Notes |
|---|---|
| `publicId` | unique, 12 chars from an unambiguous alphabet (no 0/O, 1/I) — unguessable, but readable aloud between two traders |
| `storageKey` | path / S3 key |
| `checksum` | SHA-256 of the PDF, so a recipient can prove the document is unaltered |
| `expiresAt` | optional expiry for time-boxed verification links |

### `customers`, `api_keys`, `audit_logs`
`audit_logs` is append-only: who ran what, from where, and when — answerable
months later when a valuation is disputed. Indexed on
`(organizationId, createdAt)` and `action`.

## Entity relationships

```
Organization ─┬─ User ──── RefreshToken
              ├─ BridgeRegistration ── BridgeNonce
              ├─ Customer
              ├─ ApiKey
              ├─ AuditLog
              ├─ Device ──────────┐
              └─ Inspection ◄─────┘
                    ├─ PartResultRecord
                    ├─ FindingRecord
                    └─ Report
```

## Migration and retention

- `prisma migrate deploy` runs as a dedicated ECS task before the API rolls.
- Snapshots are the largest rows. Retention policy (post-MVP): move `snapshot`
  older than 24 months to S3 behind a pointer column, keeping the scored
  `result` hot. Re-scoring an archived inspection then costs one fetch.
- GDPR erasure: deleting an `Organization` cascades to everything. Per-device
  erasure is a `Device` delete, cascading its inspections and reports — the
  salted hash means nothing survives that could re-link the handset.
