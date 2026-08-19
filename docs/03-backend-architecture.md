# 3. Backend architecture

NestJS 11 on Node 22, Prisma 6, PostgreSQL 16. Source: `apps/api`.

## Module map

```
AppModule
├── CoreModule (@Global)      config, PrismaService, AuditService,
│                             CryptoService, BridgeSignatureGuard
├── AuthModule                register, login, refresh, logout, invite, me
├── BridgesModule             pair, list, revoke, nonce pruning
├── InspectionsModule         ingest, list, detail, rescore
├── ReportsModule             PDF generation, download, public verification
├── DevicesModule             device history
├── DashboardModule           aggregate counters and breakdowns
└── HealthModule              liveness + dependency check
```

Global guards run in order: **authenticate → authorise → rate-limit**
(`JwtAuthGuard`, `RolesGuard`, `ThrottlerGuard`). Routes opt out with
`@Public()`; bridge routes opt out with `@BridgeAuth()` and use
`BridgeSignatureGuard` instead.

## Why a global CoreModule

Configuration, database access, audit and encryption are needed by nearly every
feature module. Making `CoreModule` `@Global` avoids re-importing it in each
one — and, more importantly, guarantees exactly one `PrismaService` instance
and one configuration object, so connection pooling and secret loading are not
accidentally duplicated per module.

## Request pipeline

1. `helmet` — standard hardening headers.
2. `express.json({ verify })` — captures `rawBody`. Bridge HMAC signatures must
   verify against the exact bytes received, not a re-serialisation of the
   parsed object.
3. CORS, restricted to configured dashboard origins.
4. `ValidationPipe({ whitelist: true, transform: true })` — unknown keys are
   **stripped**, not merely ignored. Several endpoints write straight into
   Prisma, and tenancy fields must never be client-settable.

> A caveat worth recording, because it bit us during development:
> `whitelist: true` strips every property that carries no validation decorator.
> The ingest DTO originally had none, so the snapshot vanished before reaching
> the service. Decorate every field you intend to receive.

## Tenancy enforcement

Tenancy is part of the **lookup**, never a post-hoc check:

```ts
this.prisma.inspection.findFirst({ where: { id, organizationId } })
```

There is no code path that fetches by id and then compares owners — the shape
that produces cross-tenant leaks the moment someone removes the comparison.
`organizationId` always comes from the signed JWT, never from a request
parameter. The e2e suite asserts a rival tenant receives 404 on read, report
generation and download.

## Ingestion: the server re-scores

`InspectionsService.ingest()` never stores the bridge's verdict:

```ts
const result = runInspection(snapshot, { udidSalt: organization.identifierSalt });
```

The bridge's own result is accepted, compared and logged when it diverges
(usually a bridge on an older engine — worth noticing if it persists), but the
stored record is always the server's. The rationale is commercial: a shop about
to sell a handset has a direct incentive to inflate its score.

Snapshot shape is validated in the service (`assertValidSnapshot`) rather than
in the DTO. The structure is large, nested and versioned, and the schema
contract belongs to the code that consumes it. A bridge is authenticated but
not trusted, so the presence and type of every field the engines read is
checked.

## Privacy at write time

`sanitiseSnapshot` redacts UDID, serial, IMEI, MEID, ICCID, IMSI, chip ID and
MAC addresses from stored JSON unless the tenant opted in; `sanitiseResult`
masks all but the last four characters of serial and IMEI. A snapshot dump is
therefore not a UDID dump. The salted `udidHash` in the relational columns is
what queries actually use.

## Report generation

PDFKit rather than headless Chrome. Reports render synchronously in roughly
30 ms, which keeps the deployment free of a browser runtime — a meaningful
reduction in image size and CVE surface. QR codes come from `qrcode` and encode
the public verification URL.

`resolveStoragePath` refuses any key that escapes the report root. Keys are
server-generated today, but that is the function an S3 migration or an import
path would reuse.

## Error handling and observability

- Domain errors are Nest HTTP exceptions; Prisma unique-constraint violations
  surface as the intended 401/409 rather than a 500.
- `AuditService.record()` is best-effort by design: an audit failure must never
  fail a technician's action, but it is logged loudly so the gap is visible.
- `/health` reports engine version, trust-algorithm version and database
  reachability, so a rolling deploy that changed engine behaviour is visible
  from the load balancer.

## Scaling notes

The API is stateless; sessions live in the database. Scale horizontally behind
the ALB. The first bottleneck will be snapshot writes (large JSONB), which is
why the retention plan in `docs/02-database-schema.md` moves cold snapshots to
S3 rather than adding read replicas first.
