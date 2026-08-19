# 14. Production deployment

## Target topology (AWS)

```
Route 53
   │
CloudFront ─── S3 (Next.js static assets)
   │
  ALB (TLS 1.2+, ACM cert)
   ├──► ECS Fargate: web   2+ tasks, 0.5 vCPU / 1 GB
   └──► ECS Fargate: api   2+ tasks, 1 vCPU / 2 GB
                │
   ┌────────────┼─────────────────┬──────────────────┐
   ▼            ▼                 ▼                  ▼
RDS PostgreSQL 16   S3 (reports)   Secrets Manager   CloudWatch
Multi-AZ, encrypted  SSE-KMS,       JWT keys,         logs + metrics
PITR 7 days          versioned      ENCRYPTION_KEY    + alarms
```

Everything runs in private subnets; only the ALB is public. The database is
reachable solely from the API's security group.

## Build and release

Images are built from `infra/api.Dockerfile` and `infra/web.Dockerfile`.
Both are multi-stage: the runtime carries no compiler, no test tooling and no
source. The API image handles device identifiers, so a smaller image is a
smaller thing to audit. Both run as a non-root user; the API declares a
`HEALTHCHECK` against `/health`.

```
docker build -f infra/api.Dockerfile -t devdna/api:$SHA .
docker build -f infra/web.Dockerfile -t devdna/web:$SHA .
```

## Migrations

`prisma migrate deploy` runs as a **separate ECS task that must succeed before
the new API task set is promoted**, not as a container entrypoint racing N
replicas. (The Dockerfile's `CMD` chains it for single-node and Compose use,
where that race does not exist.)

Migrations must be **backward compatible for one release**: the rolling deploy
briefly runs old and new code against the same schema. Additive columns first,
backfill second, drop in a later release.

## Configuration

| Variable | Source in production |
|---|---|
| `DATABASE_URL` | Secrets Manager |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Secrets Manager, rotated quarterly |
| `ENCRYPTION_KEY` | Secrets Manager / KMS — **never** in a task definition literal |
| `CORS_ORIGINS`, `PUBLIC_VERIFY_BASE_URL` | Task definition |
| `RETAIN_PLAINTEXT_IDENTIFIERS` | Task definition — leave `false` unless a tenant has a documented legal basis |

The API **refuses to boot in production** if a JWT secret or the encryption key
is missing. Development defaults exist so a fresh clone runs; production
rejects them rather than silently accepting a known key.

### Rotating `ENCRYPTION_KEY`

Bridge HMAC secrets are encrypted with it, and the ciphertext envelope is
versioned (`v1.<iv>.<tag>.<ct>`). Rotation is: deploy with both keys available,
re-encrypt `bridge_registrations.secretCiphertext` in a migration task, then
retire the old key. Plan for this before the first customer, not after.

## Report storage

Local disk in development; **S3 with SSE-KMS and versioning** in production.
`ReportsService.resolveStoragePath` is the seam — swap it for an S3 client and
nothing else changes. Reports are immutable once issued: versioning exists to
survive operator error, not to allow edits.

## Observability

| Signal | Alarm |
|---|---|
| `/health` `database: down` | Page immediately |
| API 5xx rate > 1% over 5 min | Page |
| p95 ingest latency > 2 s | Warn |
| Report generation failures | Warn |
| Audit write failures | Warn — a silent audit gap is a compliance problem |
| **Bridge/server score divergence rate** | Warn — a rising rate means fleets are on stale engines, or someone is probing |

Structured JSON logs to CloudWatch. **Never log** a raw UDID, serial, IMEI,
bridge token or bridge secret.

## Backup and recovery

- RDS automated backups, 7-day PITR; monthly restore rehearsal into a scratch
  instance. An untested backup is not a backup.
- S3 versioning plus cross-region replication for reports.
- RPO 5 min, RTO 1 h.

## Bridge distribution

The bridge is the piece that ships to customers, and it is the harder
operational problem:

- **macOS**: notarised, signed `.pkg` bundling libimobiledevice. Notarisation
  is mandatory — Gatekeeper will otherwise block it and the shop will give up.
- **Windows**: signed MSI bundling the toolchain, so nobody has to install
  iTunes.
- **Updates**: a signed manifest checked at startup, with the bridge version
  reported to the API on every ingest so the fleet's version spread is visible.
- Bridges are **revocable from the dashboard**; a lost laptop is a one-click
  problem.

## Pre-launch checklist

- [ ] Secrets in Secrets Manager, not task definitions
- [ ] `RETAIN_PLAINTEXT_IDENTIFIERS=false` confirmed
- [ ] TLS 1.2+ only; HSTS on the dashboard
- [ ] RDS Multi-AZ, encryption, PITR verified by a real restore
- [ ] Backup restore rehearsed
- [ ] WAF rate limiting in front of `/v1/auth/login`
- [ ] Alarms wired to a pager, not an inbox
- [ ] GDPR: DPA, retention policy, erasure runbook
- [ ] Report disclaimer reviewed by counsel (Apple trademark usage)
- [ ] Bridge binaries signed and notarised
