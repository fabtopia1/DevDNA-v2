# 8. API contracts

NestJS 11, all routes under `/v1`, OpenAPI served at `/docs`.

One contract decision shapes everything below: **conclusions and evidence are
different resources.** A caller can fetch conclusions without evidence, or
evidence without conclusions, and no response ever mixes an observation into a
verdict object.

## Authentication

| Caller | Mechanism |
|---|---|
| Dashboard user | JWT access token (15 min) + rotating refresh token, both in httpOnly cookies |
| Bridge daemon | HMAC-SHA256 request signature |
| Integration | API key, scoped, `Authorization: Bearer ddna_…` |
| Public verification | none — `GET /v1/verify/:publicId` only |

Roles: `OWNER > ADMIN > TECHNICIAN > VIEWER`. Guards are global; a route is
authenticated unless it declares `@Public()`.

### Bridge signatures

```
X-DevDNA-Bridge-Token: <pairing token>
X-DevDNA-Timestamp:    <unix seconds>
X-DevDNA-Nonce:        <uuid>
X-DevDNA-Signature:    hex(hmac_sha256(secret, canonical))

canonical = METHOD \n PATH \n TIMESTAMP \n NONCE \n sha256(rawBody)
```

The signature covers the **raw received bytes**, not a re-serialisation of the
parsed body. Timestamps outside the skew window are rejected; nonces are
inserted under a unique constraint, so replay detection is atomic rather than a
check-then-act race.

## Auth

```
POST   /v1/auth/register     → { organization, user, tokens }
POST   /v1/auth/login        → { user, tokens }
POST   /v1/auth/refresh      → { tokens }          (rotates, revokes the old jti)
POST   /v1/auth/logout       → 204
GET    /v1/auth/me           → { user, organization }
POST   /v1/auth/users        → { user }            (ADMIN)
```

## Inspections

### `POST /v1/inspections/ingest` — bridge only

```jsonc
{
  "snapshot":    { /* RawDeviceSnapshot, verbatim capture */ },
  "result":      { /* the bridge's own scoring — optional */ },
  "workstation": "bench-3",
  "customerId":  "cus_…"
}
```

```jsonc
→ 201 { "id": "insp_…", "deviceId": "dev_…", "report": { /* full report, identifiers masked */ } }
```

The server re-scores the snapshot and stores **its own** result. `result` is
retained for divergence detection only and is never persisted as the verdict —
the bridge runs on hardware the shop controls, and a shop about to sell a
handset has an obvious incentive to inflate its own number.

### `GET /v1/inspections`

Query: `page`, `pageSize` (≤ 100), `verdict`, `replacedComponent`, `search`,
`deviceId`, `from`, `to`.

```jsonc
{
  "items": [{
    "id": "insp_…",
    "trustScore": 95, "rawTrustScore": 95, "trustVerdict": "TRUSTED_WITH_NOTES",
    "confidence": 0.87, "coverage": 0.92,
    "identityVerdict": "IDENTITY_CONSISTENT",
    "hardwareVerdict": "SPECIFICATION_MATCH",
    "securityVerdict": "POSTURE_CLEAN",
    "batteryVerdict":  "WITHIN_SPECIFICATION",
    "batteryHealthPercent": 91, "batteryCycleCount": 214, "batteryWearGrade": "B",
    "componentsReplacedCount": 1, "hardwareAnomalyCount": 0,
    "device": { "id": "dev_…", "marketingName": "iPhone 14 Pro", "capacityGb": 256 },
    "reportCount": 1, "evidenceCount": 184
  }],
  "page": 1, "pageSize": 25, "total": 132, "totalPages": 6
}
```

`replacedComponent=DISPLAY` filters through `component_service_results`, so
*"show me everything with a replaced display"* is one indexed query.

### `GET /v1/inspections/:id` — conclusions

Returns the inspection with `device`, `user`, `bridge`, `customer`,
`components[]`, `findings[]`, `verdicts[]`, `reports[]`, and counts of evidence,
inferences and audit entries. **No evidence records.**

Every component carries both fields, never one:

```jsonc
{ "subject": "DISPLAY", "verdict": "REPLACED_LIKELY",
  "authenticity": "GENUINE_APPLE", "confidence": 0.63,
  "rationale": "iOS lists this component in Parts and Service History…" }
```

Tenancy is part of the lookup (`where: { id, organizationId }`), not a post-hoc
check, so a wrong-tenant id is a 404 and leaks nothing.

### `GET /v1/inspections/:id/evidence` — evidence

Query: `subject`.

```jsonc
{
  "ledgerDigest": "9f2c…",
  "evidence": [{
    "evidenceId": "ev_4a91…", "kind": "MEASUREMENT", "subject": "BATTERY",
    "key": "CycleCount", "value": 214,
    "sourceAuthority": "DEVICE_OS", "method": "LOCKDOWN_DOMAIN_QUERY",
    "collector": "battery.lockdown", "observedAt": "2026-08-19T09:12:04.000Z",
    "reliability": 0.95, "raw": "CycleCount = 214"
  }],
  "inferences": [{
    "inferenceId": "in_77b0…", "module": "SERVICE_EVIDENCE",
    "rule": "service.listed-in-service-history", "subject": "DISPLAY",
    "direction": "SUPPORTS_NEGATIVE", "statement": "iOS lists this component…",
    "weight": 0.9, "confidence": 0.63, "evidenceIds": ["ev_1c33…"]
  }]
}
```

Collection failures appear here as ordinary records with
`kind: "COLLECTION_FAILURE"` and the reason as the value. They are not filtered
out — an abstention that cannot show why it abstained is indistinguishable from
one that never looked.

Identifying values are decrypted server-side and **masked at this boundary**.
The stored value stays intact so the ledger remains reproducible.

### `GET /v1/inspections/:id/audit`

The ordered reasoning trail: `sequence`, `at`, `module`, `action`, `summary`,
`refs`.

### `POST /v1/inspections/:id/rescore` — TECHNICIAN

Recomputes from the stored ledger under the current engine.

```
200 { "id": "insp_… (new)", "deviceId": "dev_…", "report": { … } }
400  Stored evidence does not match the digest recorded at inspection time; refusing to re-score.
400  Stored evidence failed integrity verification (N record(s)); refusing to re-score.
```

Two properties worth stating explicitly:

- It reads the **ledger**, not the snapshot. That is the whole reason evidence
  is stored as first-class rows.
- It creates a **new** inspection. A report already given to a trading partner
  must keep saying what it said.

## Reports

```
POST /v1/inspections/:id/report   → { id, publicId, checksum, sizeBytes }   TECHNICIAN
GET  /v1/reports/:id/download     → application/pdf
GET  /v1/verify/:publicId         → public verification                     PUBLIC
```

The public payload restates the verdict, the module verdicts, the assessed
components, `notAssessed`, the document checksum and the `evidenceLedgerDigest`
— and nothing that identifies the handset or the technician. It carries
`notAssessed` because **a shorter component list must never read as a cleaner
device**.

When the verdict is `INSUFFICIENT_EVIDENCE`, no score is returned at all. There
is nothing a score could honestly summarise.

## Devices, bridges, dashboard

```
GET    /v1/devices           list, with inspection history
GET    /v1/devices/:id       one device and its inspections over time
GET    /v1/bridges           list registered workstations
POST   /v1/bridges           register → { pairingToken, secret }  (shown once)  ADMIN
DELETE /v1/bridges/:id       revoke                                             ADMIN
GET    /v1/dashboard/summary?days=30
GET    /health
```

`/v1/dashboard/summary` returns totals, averages, recent inspections,
`componentOutcomes`, `moduleCoverage` (determined vs indeterminate per module),
`failingCollectors` and `topFindings`. The abstention and failing-collector
figures are there because a rising abstention rate means a data source has been
closed off upstream, and that is worth more operationally than any single
inspection.

## Errors

Standard NestJS envelope: `{ statusCode, message, error }`.

| Code | Used for |
|---|---|
| 400 | validation failure; digest or integrity mismatch on re-score |
| 401 | missing/invalid credentials; unknown, revoked or undecryptable bridge |
| 403 | authenticated but insufficient role |
| 404 | not found **or** belongs to another tenant |
| 409 | nonce replay |
| 429 | rate limit |

404-for-cross-tenant is deliberate: distinguishing "does not exist" from "not
yours" would confirm that a given inspection id exists in someone else's
account.

## Versioning

The URL carries the API version; `engineVersion` and `algorithmVersion` are
carried on every inspection and every report. A score is only meaningful
alongside the engine that produced it, and a historical report must stay
explainable by code that has since moved on.

## Adapter surface

External authorities are **not** new endpoints. An adapter implements
`ExternalEvidenceAdapter`, runs during collection, and contributes
`EvidenceRecord`s to the same ledger. Every route above keeps its shape; the
evidence response simply gains records with a different `sourceAuthority`.
