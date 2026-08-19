# 9. API specification

Base URL `/`, versioned routes under `/v1`. OpenAPI is served at `/docs` in
non-production environments (`@nestjs/swagger`).

Auth schemes:
- **Bearer** — `Authorization: Bearer <accessToken>` (JWT, 15 min).
- **Bridge signature** — HMAC headers, ingest only. See below.
- **Public** — no auth (`/health`, `/v1/verify/:publicId`, auth endpoints).

Roles rank `OWNER > ADMIN > TECHNICIAN > VIEWER`; a route marked `TECHNICIAN`
also admits ADMIN and OWNER.

---

## Health

### `GET /health` · public
```json
{ "ok": true, "service": "devdna-api", "engineVersion": "1.0.0",
  "trustAlgorithmVersion": "1.0.0", "database": "up",
  "timestamp": "2026-03-14T10:24:00.000Z" }
```

---

## Auth — `/v1/auth`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/register` | public | Create an organization + owner |
| POST | `/login` | public | Credentials → token pair |
| POST | `/refresh` | public | Rotate a refresh token |
| POST | `/logout` | public | Revoke a refresh token |
| GET | `/me` | bearer | Current user + organization |
| POST | `/users` | ADMIN | Add a user to the organization |

**`POST /v1/auth/register`**
```json
{ "organizationName": "Northside Repairs", "name": "Sam Okafor",
  "email": "sam@northside.example", "password": "at-least-12-chars" }
```
→ `201` `{ organization, user, accessToken, refreshToken, expiresIn }`

Passwords are Argon2id with tuned parameters. Login verifies against a dummy
hash when the user is unknown, so response timing does not disclose whether an
email is registered. Refresh tokens rotate on every use and are stored hashed;
replaying a rotated token returns 401 and is a strong theft signal.

Errors: `409` email exists · `400` validation · `401` bad credentials.

---

## Bridges — `/v1/bridges`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/` | bearer | List paired workstations |
| POST | `/` | ADMIN | Pair a workstation |
| DELETE | `/:id` | ADMIN | Revoke a workstation |

**`POST /v1/bridges`** → `201`
```json
{ "id": "...", "name": "Bench 1",
  "token": "dbt_…", "secret": "…",
  "setup": { "env": { "DEVDNA_BRIDGE_TOKEN": "…", "DEVDNA_BRIDGE_SECRET": "…" },
             "command": "devdna-bridge serve" } }
```
The token and secret are returned **once**. The token is stored hashed and the
secret encrypted; no endpoint can return them again.

---

## Inspections — `/v1/inspections`

### `POST /v1/inspections/ingest` · bridge signature

Headers:

| Header | Value |
|---|---|
| `x-devdna-bridge-token` | the pairing token |
| `x-devdna-timestamp` | unix seconds, ±300s window |
| `x-devdna-nonce` | UUID, unique per bridge |
| `x-devdna-signature` | `HMAC-SHA256(secret, canonical)` |

Canonical string:
```
METHOD \n PATH \n TIMESTAMP \n NONCE \n sha256(rawBody)
```

Body: `{ snapshot, result?, workstation?, customerId? }`

`result` is the bridge's own scoring. It is **not** stored — the server
re-scores the raw snapshot and logs any divergence.

→ `201` `{ id, deviceId, result }`

Errors: `401` bad signature / stale timestamp / replayed nonce / revoked bridge ·
`400` malformed or unsupported snapshot schema.

### `GET /v1/inspections` · bearer

Query: `page`, `pageSize` (≤100), `status`, `search`, `deviceId`, `from`, `to`.

→ `{ items[], page, pageSize, total, totalPages }`

### `GET /v1/inspections/:id` · bearer
Full detail: identity, battery, software, per-component verdicts **with their
signals**, findings, bridge, customer and issued reports.
`404` if it belongs to another organization — tenancy is part of the lookup.

### `POST /v1/inspections/:id/rescore` · TECHNICIAN
Re-scores the stored snapshot under the current engine and creates a **new**
inspection. The original is untouched: a report already handed to a trading
partner must keep saying what it said.

---

## Reports

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/v1/inspections/:id/report` | TECHNICIAN | Generate a PDF |
| GET | `/v1/reports/:id/download` | bearer | Download the PDF |
| GET | `/v1/verify/:publicId` | **public** | Verify a report by its QR code |

**`POST /v1/inspections/:id/report`** → `201`
```json
{ "id": "...", "publicId": "SKRP6HHZ9EE3",
  "verifyUrl": "https://app.devdna.io/verify/SKRP6HHZ9EE3",
  "checksum": "7d887444…", "sizeBytes": 8623 }
```

**`GET /v1/verify/:publicId`** returns the verdict, component verdicts, issuing
organization and document checksum — and deliberately **no** UDID, serial,
IMEI, customer or technician. The caller is a stranger holding a PDF.

---

## Devices — `/v1/devices`

| Method | Path | Auth |
|---|---|---|
| GET | `/` | bearer — paginated, `search` |
| GET | `/:id` | bearer — detail + last 50 inspections |

---

## Dashboard

### `GET /v1/dashboard/summary?days=30` · bearer
Totals, averages, status breakdown, per-component verdict breakdown, top
findings and recent activity — all scoped to the caller's organization.

---

## Conventions

- **Errors**: standard Nest shape `{ statusCode, message, error }`.
- **Rate limiting**: 120 req/min per IP. Shop networks are often NAT'd behind
  one address, so the limit is generous enough not to punish a busy counter
  while still blunting credential stuffing.
- **Validation**: unknown body keys are stripped, never trusted.
- **Pagination**: `page` / `pageSize`, `pageSize` capped at 100.
- **Timestamps**: ISO-8601 UTC throughout.
