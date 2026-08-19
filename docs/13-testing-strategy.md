# 13. Testing strategy

## What is tested today

| Suite | Count | Runtime | What it covers |
|---|---|---|---|
| `packages/core` | **53** | ~0.8 s | Parsers, catalogs, scoring curves, verdict rules, gates, end-to-end determinism |
| `apps/bridge` | **7** | ~3 s | UDID validation, simulator collection, loopback auth, inspection over HTTP, attestation handling |
| `apps/api` | **23** | ~1 s | Full lifecycle against real PostgreSQL |
| **Total** | **83** | | |

Run everything: `pnpm -r test`.

## The testing philosophy

A verification product's tests have to assert **what it refuses to claim**, not
just what it computes. Roughly a third of the suite exists to pin down negative
behaviour:

- `never concludes genuine from an absence of evidence`
- `refuses to certify a low-confidence inspection`
- `reports zero confidence and raises findings when no health source answers`
- `ignores a trust score claimed by the bridge and re-scores the raw snapshot`
- `verifies a report publicly without leaking device identifiers`
- `degrades gracefully for unknown product types instead of guessing a name`

If these ever go green when they should be red, the product is lying to a
buyer. That is a worse failure than a crash.

## Unit tests — `packages/core`

Pure functions with no I/O, so the whole suite runs in under a second and is
practical to run on every save.

Notable properties asserted:

- **Monotonicity** — the battery health curve never decreases as capacity rises
  (checked across all 100 integer values, not at sample points).
- **Published calibration points** — the health and cycle tables in
  `docs/08-trust-score-algorithm.md` are asserted directly, so the documentation
  cannot silently drift from the code.
- **Determinism** — every fixture is inspected twice and the results deep-compared.
- **Tenant unlinkability** — the same device hashed under two salts must differ.
- **No duplicate finding codes** across any fixture.
- **Severity ordering** of the findings list.
- **Parser robustness** — the analytics extractor is asserted never to throw on
  malformed input, because it consumes an undocumented schema that Apple
  reshapes between releases.

## Bridge tests

Run against the real Fastify instance via `app.inject()`, in simulator mode.

Security-relevant assertions:
- `/health` is open; every other route returns 401 without the pairing token,
  and 401 with a wrong one.
- `assertValidUdid` rejects shell metacharacters, flag-like strings, traversal
  sequences and over-long input — the inputs that would matter if the exec
  layer ever regressed to a shell.

## API end-to-end tests

Against a real PostgreSQL database (`devdna_test`), with the real guard stack.
NestJS DI needs `design:paramtypes` metadata, which esbuild does not emit, so
this suite is transformed with SWC (`unplugin-swc`) rather than vitest's default.

Coverage:

| Area | Assertions |
|---|---|
| Auth | register, weak-password rejection, login, `/me`, invite |
| Session | refresh rotation, replayed refresh token rejected |
| Bridge auth | valid signature accepted; tampered signature, replayed nonce and stale timestamp all rejected |
| **Integrity** | a forged `result` claiming 100 is ignored; the stored score is the server's |
| Privacy | raw identifiers stripped from the stored snapshot; salted hash present |
| **Tenancy** | a rival tenant gets 404 on read, report generation and download, and an empty list |
| RBAC | a VIEWER can read but cannot generate a report or pair a workstation |
| Reports | PDF generated, `%PDF-` header, checksum matches the download byte-for-byte |
| Public verify | verdict returned; response asserted to contain no udid/serial/imei/technician |
| Audit | organization, bridge, inspection and report actions all recorded |

## Frontend verification

The dashboard was driven end to end in headless Chromium against the running
API: sign in, dashboard, inspection list, detail with evidence, report
generation, PDF download and public verification, with console errors captured.

**Gap, stated plainly:** there is no automated frontend test suite yet. Phase 1
should add Playwright specs covering the same path, plus an axe accessibility
pass. The manual browser run proved the flow works; it does not protect it from
regression.

## What is deliberately not tested, and why

- **Real hardware.** No iPhone can be attached in CI. The simulator exercises
  the identical engine path, but the `libimobiledevice` adapter's parsing of
  *real* tool output is only covered by fixtures derived from documented
  formats. Phase 1's capture programme exists partly to build a corpus of real
  captures to replay in CI.
- **Parts engine accuracy.** Precision and recall cannot be measured without
  labelled real devices. The current tests prove the rule engine behaves as
  specified; they say nothing about whether the thresholds are *right*. That is
  a Phase 1 exit criterion, and it is the most important open question in the
  product.

## CI pipeline (recommended)

```yaml
1. pnpm install --frozen-lockfile
2. pnpm -r typecheck
3. pnpm --filter @devdna/core test          # fast, fails first
4. services: postgres:16 → prisma migrate deploy
5. pnpm -r test
6. pnpm -r build                            # incl. next build
7. docker build -f infra/api.Dockerfile .
```

Core tests run before database provisioning so the cheapest signal arrives first.
