# 11. Security architecture

## Threat model

The realistic adversaries, in order of likelihood:

| # | Adversary | Goal | Primary control |
|---|---|---|---|
| 1 | **A shop inflating its own scores** | Sell a handset for more than it is worth | Server-side re-scoring; the bridge's verdict is never stored |
| 2 | **A competitor** | See which devices a rival handled | Structural tenancy; per-tenant identifier salts |
| 3 | **A forger** | Issue a fake DevDNA report | Public verification with document checksum; server-issued `publicId` |
| 4 | **A thief with a stolen laptop** | Use a paired bridge's credentials | HMAC binds credentials to each request; revocable pairings |
| 5 | **An opportunist with a leaked DB dump** | Mint sessions or forge bridge submissions | Hashed tokens; encrypted HMAC secrets; Argon2id passwords |
| 6 | **An XSS payload in the dashboard** | Read a bearer token, issue fraudulent reports | httpOnly cookies; nonce CSP; allowlisted proxy |

## Trust boundaries

```
  UNTRUSTED                    SEMI-TRUSTED              TRUSTED
 ┌──────────┐    HMAC-signed  ┌────────────┐  bearer   ┌───────────┐
 │  Bridge  │ ──────────────► │  Dashboard │ ────────► │    API    │
 │ (shop HW)│                 │  (SSR)     │           │  + DB     │
 └──────────┘                 └────────────┘           └───────────┘
      ▲ loopback + pairing token
   Browser
```

The bridge is **authenticated but not trusted**. That distinction is the single
most important security decision in the product.

## Authentication

**Users.** Argon2id (`memoryCost 19456, timeCost 2, parallelism 1`) —
deliberately above library defaults, because the whole value of the product
rests on inspection records being attributable, and a stolen password database
is the cheapest route to forging them. Minimum 12 characters: shop staff share
workstations and reuse passwords heavily, and length is the only control that
reliably survives that.

JWT access tokens (15 min) carry `typ: 'access'`; the guard rejects a refresh
token presented as an access token. Refresh tokens (30 days) are stored hashed,
rotate on every use, carry a `jti` (without which two tokens minted in the same
second collide on their hash), and are individually revocable.

**Bridges.** Token + HMAC over method, path, timestamp, nonce and body hash.
Timestamp window ±300 s; nonce uniqueness enforced by a database constraint, so
replay rejection is atomic rather than a check-then-act race.

## Authorisation

`RolesGuard` compares numeric rank, so a route requiring `TECHNICIAN` admits
ADMIN and OWNER without enumerating them. Tenancy is enforced in the query, not
after it — verified by e2e tests that assert a rival tenant gets 404 on read,
report generation and download.

## Secrets

| Secret | At rest | Why |
|---|---|---|
| User password | Argon2id hash | Never needs recovery |
| Refresh token | SHA-256 hash | Only ever compared |
| Bridge pairing token | SHA-256 hash | Only ever compared |
| **Bridge HMAC secret** | **AES-256-GCM ciphertext** | Must be recoverable to verify a signature |
| JWT signing keys | Environment / Secrets Manager | Never in the database |

The bridge secret is the interesting case: hashing it is impossible because
verifying an HMAC requires the original key, and storing it in the clear would
make a database leak sufficient to forge inspection records for any tenant. So
it is encrypted with an application key that lives outside the database.

**Known limitation.** Symmetric HMAC means the API could in principle compute a
valid bridge signature. Ed25519 — bridge holds the private key, server stores
only the public key — removes that entirely and is the planned upgrade. The
canonical string is already scheme-agnostic.

The API refuses to boot in production without `JWT_ACCESS_SECRET`,
`JWT_REFRESH_SECRET` and `ENCRYPTION_KEY`; development gets working defaults so
a fresh clone runs, but those defaults are rejected in production rather than
silently accepted.

## Personal data

UDIDs, serials and IMEIs are personal data under GDPR. The evidence
architecture changes how they are handled, because the ledger has to stay
reproducible.

- **Device rows are keyed by per-tenant salted SHA-256**, never by raw
  identifier. The per-tenant salt matters: a global salt would let one shop hash
  a UDID and confirm whether a rival had handled that exact handset.
- **Identifying evidence values are encrypted, not redacted.** They are stored
  as `{ "__enc": "<AES-256-GCM ciphertext>" }` under the application key.

  Redaction looked like the privacy-preserving choice and was in fact a
  correctness bug: the ledger is what re-scoring reads, so a masked IMEI would
  be re-checked against its Luhn digit on the next re-score and come back as an
  identity mismatch. Worse, masking changes the ledger content, so the digest no
  longer verifies — and genuine tampering becomes indistinguishable from our own
  redaction. Encryption preserves the exact bytes; a database leak alone still
  yields no identifiers.
- **Masking happens at API egress**, where it belongs. `GET /…/evidence`
  decrypts server-side and returns a masked tail; the stored value is untouched.
- Plaintext retention is opt-in per organization (`RETAIN_PLAINTEXT_IDENTIFIERS`)
  for operators whose jurisdiction requires it.
- Public verification exposes none of them.
- Analytics files pulled off a handset are scanned in a temp directory and
  deleted. DevDNA never retains a customer's raw analytics.
- Erasure: deleting an organization cascades to devices, inspections, evidence,
  inferences, verdicts, findings and audit entries. The salted hash means
  nothing survives that could re-link the handset.

## Web application security

- **httpOnly cookies**, never `localStorage`, for session tokens.
- **Per-request nonce CSP** with `strict-dynamic`; `object-src 'none'`,
  `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`.
- **Allowlisted proxy** — the handler that attaches the bearer token matches an
  explicit `(method, pattern)` list.
- **Open-redirect prevention** — `?next=` must be a same-origin relative path.
- `helmet` on the API; CORS restricted to configured origins.

## Command execution on the technician's machine

`execFile` with argument arrays, never a shell. UDIDs are format-validated
before reaching a tool, and lockdown domains / IORegistry class names are
regex-constrained. Both device output and dashboard input reach this layer.

## Audit

Two audits, deliberately distinct — see
[06-audit-model.md](06-audit-model.md).

**Operational.** Append-only `audit_logs` records organization creation, login,
bridge pairing and revocation, inspection ingestion, re-scoring, user invitation
and report generation — each with actor, IP and user agent. Best effort by
design so it never fails a technician's action, but logged loudly when it fails.

**Evidentiary.** Every inspection stores the ledger digest, a per-record
content-addressed id, the ordered reasoning trail, and the result of a post-hoc
provenance audit. This is a security control, not only a product feature: a row
edited directly in the database no longer matches its own content-addressed id,
and `POST /v1/inspections/:id/rescore` verifies both the digest and per-record
integrity before recomputing. Re-scoring tampered evidence would launder an edit
into a fresh, apparently authoritative verdict, so it is refused with a 400.

## What is deliberately not claimed

DevDNA does not defend against a **jailbroken handset lying to it**. A modified
system can falsify every value in the pipeline. The engine detects the common
indicators (known bundle IDs, the `com.apple.afc2` service) and caps the trust
score at 35 through the `INTEGRITY_COMPROMISED` gate with a `CRITICAL` finding,
but this is detection, not prevention — and the report says so rather than
implying otherwise.
