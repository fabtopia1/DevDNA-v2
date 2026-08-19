# DevDNA SoftwareDNA

**iPhone verification for repair shops, refurbishers and resale businesses.**

Connect an iPhone to a laptop by USB and get a defensible answer to the question
the resale market cannot answer for itself: *is this device what it claims to
be?*

DevDNA is a **trust and evidence system**, not a diagnostics collector. It
observes facts, derives claims that cite those facts, and concludes verdicts
that cite those claims — and it will not produce a conclusion that cannot point
at the observation behind it.

It reads only what a handset makes available over a standard, user-authorised
USB pairing — the same services Finder and Apple Configurator use. No jailbreak,
no exploits, no Apple-internal tooling, no GSX dependency.

---

## What it produces

```
  iPhone 14 Pro  128GB  iOS 18.2
  United Kingdom / Ireland  ·  unit: retail

  Identity   IDENTITY_CONSISTENT    confidence 74%
  Hardware   SPECIFICATION_MATCH    confidence 97%
  Security   POSTURE_CLEAN          posture 100/100
  Battery    WITHIN_SPECIFICATION   grade B  health 93%  cycles 412

  Battery replacement within 12 months: 4% likely

  Service evidence  (75% of component weight determined)
    Display        REPLACED_LIKELY     [genuine apple]
    Battery        REPLACED_LIKELY     [genuine transplanted]
    Rear Camera    REPLACED_LIKELY     [genuine apple]
    Front Camera   ORIGINAL_LIKELY
    Face ID        ORIGINAL_LIKELY

  TRUST  95/100   TRUSTED_WITH_NOTES   (confidence 76%, coverage 85%)

    capped at 97: 85% of the assessable picture was established; a flawless
    score requires near-total coverage.

    [MEDIUM] Trust score capped at 97
    [MEDIUM] Battery: genuine Apple part from another device
    [LOW] 5 of 8 identifier checks could be run

  48 evidence records · ledger 0c93e0b57cca4ad8
```

That is real output, not a mockup — reproduce it with the command below.

Read it carefully and three design decisions show up at once. This device scores
95 *and* is disclosed as serviced, because replacement and authenticity are
different questions. It is capped at 97 rather than printing a flat 100, because
15% of the picture was never established. And six of the eleven components it
looked at are absent from the list — they are not silently passed, they are
`CANNOT_DETERMINE`, which is what the missing 25% of component weight is.

…plus a PDF verification report with a QR code any buyer can scan to confirm the
report is genuine and unaltered.

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

## How it works

Five layers, each reading only the one before it:

```
capture ──► evidence ──► inference ──► modules ──► trust
snapshot    facts with   claims that   verdicts    one score,
            provenance   cite facts    per subject one verdict,
                                                   one audit trail
```

The **evidence ledger** is the artifact. Every record carries where it came
from, how, when, and how far that channel can be believed. Every inference cites
evidence by id; every verdict cites inferences. The Provenance Engine enforces
this at construction — it throws rather than build an unsupported conclusion —
and a post-hoc audit re-checks the finished report.

Because the ledger is sufficient on its own, `evaluate(ledger)` recomputes every
verdict, score and audit entry with no access to the original device. A test
asserts a report rebuilt from persisted evidence is deep-equal to the original.

Seven modules: **Identity**, **Hardware Consistency**, **Service Evidence**,
**Battery Intelligence**, **SecurityDNA**, **Provenance** (enforcement), and
**Trust** (aggregation). `CANNOT_DETERMINE` appears in every vocabulary, because
abstention is a real outcome and never a fallback that gets rounded into a pass.

A browser cannot open a USB endpoint to an iPhone, so the thing that reads the
phone (**DevDNA Bridge**, a local agent driving `libimobiledevice`) is separate
from the thing that serves the dashboard (**Next.js + NestJS**). The bridge
scores locally so a shop with no internet still gets a verdict on the bench; the
server **re-scores the capture and stores that**, because a shop about to sell a
handset has an obvious incentive to inflate its own number.

```
iPhone ──USB──► DevDNA Bridge ──loopback──► Dashboard ──HTTPS──► API ──► PostgreSQL
                      └──────── HMAC-signed ingest ─────────────►
```

## Repository

| Path | What |
|---|---|
| `packages/core` | Evidence ledger, provenance enforcement, confidence model, seven modules, device catalog. Pure and deterministic. **97 tests.** |
| `apps/bridge` | Local USB agent, CLI and loopback API. **7 tests.** |
| `apps/api` | NestJS: tenancy, signed ingest, evidence persistence, re-scoring, PDF reports, audit. **28 e2e tests.** |
| `apps/web` | Next.js dashboard, evidence drawer, public verification. |
| `docs/` | Nine deliverable documents — [start here](docs/README.md). |

```bash
pnpm -r test        # 132 tests
pnpm -r typecheck
pnpm -r build
```

## What it can and cannot do

DevDNA is explicit about its limits, because a verification product that
oversells its certainty is worse than no product.

- **Absence of evidence is never evidence of authenticity.** A component DevDNA
  could not assess is reported as undetermined and counted against coverage — it
  is never quietly treated as original. A shorter component list must never read
  as a cleaner device.
- **Parts & Service History has no public API.** Apple renders it on-device
  only. Component verdicts come from evidence — analytics traces, cell identity,
  capability probes, or a technician transcribing Apple's own screen. Every
  verdict names its sources and its confidence.
- **Listed in Service History means serviced** — including when the label reads
  "Genuine Apple Part". That label describes what was fitted, not whether the
  component is original to the device. Conflating the two systematically
  overvalues repaired handsets, and DevDNA keeps them as separate fields.
- **Battery health and cycle count** come from a provider chain (diagnostics
  registry → device analytics → lockdown). Apple restricts the best source on
  modern iOS; when every provider refuses, the refusal is recorded as evidence
  and the verdict is `CANNOT_DETERMINE` at zero confidence, not an invented
  number.
- **Low confidence outranks a high score.** Below the reporting threshold an
  inspection returns `INSUFFICIENT_EVIDENCE` and no number is printed at all.
- **A jailbroken device can lie about everything.** DevDNA detects the common
  indicators and caps trust at 35, but this is detection, not prevention.

Read [docs/12](docs/12-risks-and-limitations.md) before making any commercial
promise on DevDNA's behalf.

---

DevDNA is not an Apple product and is not endorsed by or affiliated with
Apple Inc.
