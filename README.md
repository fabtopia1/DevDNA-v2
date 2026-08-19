# DevDNA SoftwareDNA

**iPhone verification for repair shops, refurbishers and resale businesses.**

Connect an iPhone to a laptop by USB and get a defensible answer to the
question the resale market cannot answer for itself: *is this device what it
claims to be?*

DevDNA reads only what a handset makes available over a standard,
user-authorised USB pairing — the same services Finder and Apple Configurator
use. No jailbreak, no exploits, no Apple-internal tooling.

---

## What it produces

```
  iPhone 14 Pro · 128 GB · iOS 18.2 · United Kingdom / Ireland

  Battery    85   health 93%   cycles 412 / 500 rated
  Software   97   iOS 18.2
  Parts      93   coverage 66%

    Display        Genuine Apple Part      (67% confidence)
    Battery        Used Apple Part         (55% confidence)
    Rear Camera    Genuine Apple Part      (55% confidence)
    Face ID        Genuine Apple Part      (27% confidence)

  TRUST SCORE  91/100   VERIFIED   (confidence 76%)

    capped at 95: 66% of component weight was assessed.
```

That is real output, not a mockup — reproduce it with the command below.

…plus a PDF verification report with a QR code that any buyer can scan to
confirm the report is genuine and unaltered.

## Quick start

```bash
pnpm install

# 1. Database
docker compose up -d postgres
cd apps/api
cp ../../.env.example .env          # then edit DATABASE_URL if needed
pnpm prisma:migrate && pnpm seed

# 2. API  (http://localhost:4000, OpenAPI at /docs)
pnpm build && pnpm start

# 3. Dashboard  (http://localhost:3000)
cd ../web && DEVDNA_API_URL=http://localhost:4000 pnpm dev

# 4. Bridge — no iPhone required
cd ../bridge && pnpm dev -- --simulator
```

Sign in with `owner@demoshop.test` / `DevDNA-demo-2026`, then open
**New inspection** and paste the pairing token the bridge printed.

Or skip the UI entirely:

```bash
pnpm --filter @devdna/bridge exec tsx src/cli.ts inspect serviced-14-pro --simulator
```

### With a real iPhone

```bash
# macOS
brew install libimobiledevice ideviceinstaller
# Linux
sudo apt install libimobiledevice-utils ideviceinstaller

devdna-bridge doctor      # verify the toolchain
devdna-bridge devices     # unlock the handset and tap Trust
devdna-bridge inspect <udid>
```

## Architecture in one paragraph

A browser cannot open a USB endpoint to an iPhone, so the thing that reads the
phone (**DevDNA Bridge**, a local agent driving `libimobiledevice`) is separate
from the thing that serves the dashboard (**a Next.js + NestJS cloud app**).
The bridge produces a raw device snapshot and scores it locally so a shop with
no internet still gets a verdict; the cloud **re-scores the raw snapshot** and
stores *that*, because a shop about to sell a handset has an obvious incentive
to inflate its own number. Snapshots are kept verbatim, so any inspection can
be re-scored later under an improved engine.

```
iPhone ──USB──► DevDNA Bridge ──loopback──► Dashboard ──HTTPS──► API ──► PostgreSQL
                      └──────── HMAC-signed ingest ─────────────►
```

## Repository

| Path | What |
|---|---|
| `packages/core` | The domain: parsers, inspection engines, trust scoring. Pure and deterministic. **53 tests.** |
| `apps/bridge` | Local USB agent, CLI and loopback API. **7 tests.** |
| `apps/api` | NestJS: tenancy, auth, ingest, PDF reports, audit. **23 e2e tests.** |
| `apps/web` | Next.js dashboard, inspection flow, public verification. |
| `docs/` | The full technical blueprint — [start here](docs/README.md). |

```bash
pnpm -r test        # 83 tests
pnpm -r typecheck
pnpm -r build
```

## What it can and cannot do

DevDNA is explicit about its limits, because a verification product that
oversells its certainty is worse than no product.

- **Battery health and cycle count** come from a provider chain (diagnostics
  registry → device analytics → lockdown). Apple restricts the best source on
  modern iOS, so when every provider refuses, DevDNA reports *zero confidence*
  rather than inventing a number.
- **Parts & Service History has no public API.** Apple renders it on-device
  only. DevDNA infers component verdicts from evidence — analytics traces,
  cell identity, capability probes — and lets a technician transcribe Apple's
  own screen for the strongest signal. Every verdict carries its sources and a
  confidence figure, and `CANNOT_DETERMINE` is a first-class answer.
- **A jailbroken device can lie about everything.** DevDNA detects the common
  indicators and caps trust at 40, but this is detection, not prevention.

Read [docs/15](docs/15-risks-and-limitations.md) before making any commercial
promise on DevDNA's behalf.

---

DevDNA is not an Apple product and is not endorsed by or affiliated with
Apple Inc.
