# 1. System architecture

## The constraint that shapes everything

A browser cannot open a USB endpoint to an iPhone. WebUSB does not reach
Apple's `usbmux` transport, and Apple's device services require a persistent
trust pairing negotiated by a native process. So the central architectural
fact of DevDNA is this:

> **The thing that reads the phone cannot be the thing that serves the
> dashboard.** They are separate programs, on separate machines, in separate
> trust domains.

Everything below follows from that.

```
  Technician's bench                        DevDNA cloud
 ┌─────────────────────────┐              ┌──────────────────────────────┐
 │  iPhone                 │              │                              │
 │    │ USB (Lightning/    │              │   Next.js dashboard          │
 │    │ USB-C)             │   HTTPS      │   (server components)        │
 │    ▼                    │  ◄────────►  │            │                 │
 │  usbmuxd                │              │            ▼                 │
 │    │                    │              │   NestJS API                 │
 │    ▼                    │              │     ├── inspection engine    │
 │  DevDNA Bridge          │   HTTPS      │     ├── report generator     │
 │  (Node, loopback :7411) │  ─────────►  │     └── audit log            │
 │                         │  signed      │            │                 │
 └─────────────────────────┘  ingest      │            ▼                 │
          ▲                               │   PostgreSQL   ·   S3        │
          │ loopback HTTP + WS            └──────────────────────────────┘
          │ (pairing-token authenticated)
   Browser tab (dashboard page)
```

## Components

| Component | Runs on | Responsibility | Trust level |
|---|---|---|---|
| **DevDNA Bridge** (`apps/bridge`) | Shop laptop, macOS/Windows | Holds the USB trust pairing, drives libimobiledevice, produces a `RawDeviceSnapshot` | **Untrusted.** Shop-owned hardware. |
| **@devdna/core** (`packages/core`) | Both bridge and API | Parsers, inspection engines, scoring. Pure and deterministic. | n/a — a library |
| **API** (`apps/api`) | Cloud | Authoritative scoring, tenancy, persistence, reports, audit | Trusted |
| **Dashboard** (`apps/web`) | Cloud (SSR) + browser | Technician UI, evidence display, public verification | Semi-trusted |
| **PostgreSQL** | Cloud | Inspections, devices, tenancy, audit | Trusted |
| **Object storage** | Cloud | Generated PDF reports | Trusted |

## The two-scoring rule

`runInspection()` runs **twice** for every inspection, and this is deliberate:

1. **On the bridge**, so a shop with no internet still gets a verdict on the
   bench. Local scoring is what makes DevDNA usable in a market stall.
2. **On the API**, over the raw snapshot, and *this* result is what gets
   stored, reported and shown to a buyer.

The bridge's own score is submitted alongside the snapshot but is used only for
divergence logging. The reason is commercial, not paranoid: a shop about to
sell a handset has a direct financial incentive to inflate its trust score, and
the bridge runs on hardware they control. If the number a buyer sees could be
dictated by the seller's laptop, the product has no reason to exist.

Because the raw snapshot is stored verbatim, an inspection can also be
**re-scored** later under an improved engine (`POST /v1/inspections/:id/rescore`).
That creates a *new* inspection record — a report already handed to a trading
partner must keep saying what it said.

## Data flow of one inspection

1. Technician plugs in an iPhone. `usbmuxd` sees it; the bridge's watcher polls
   `idevice_id -l` every 2s and pushes a `device-connected` event over the
   loopback WebSocket.
2. The dashboard lists the device. If it is not yet trusted, the UI says
   *"Tap Trust This Computer on the iPhone"* rather than showing an empty read.
3. Technician optionally transcribes **Settings › General › About › Parts and
   Service History** into the attestation panel.
4. Technician clicks Run. The bridge collects:
   lockdown global domain → scoped domains → `AppleSmartBattery` IORegistry →
   installed apps → advertised services → aggregated analytics files.
   Each stage streams a progress event; each failure is recorded as a typed
   `CollectionError` rather than aborting.
5. Bridge scores locally, shows the verdict, and `POST`s the snapshot to
   `/v1/inspections/ingest`, HMAC-signed.
6. API verifies the signature, re-scores, upserts the device, writes the
   inspection with denormalised part verdicts and findings, and audits it.
7. Technician generates a PDF; a QR code on it points at the public
   `/verify/:publicId` page.

## Why a local agent rather than a native desktop app

The bridge is a headless daemon plus a browser UI, not an Electron app, because:

- The dashboard needs to be updatable without asking every shop to update
  software. Engine improvements ship server-side and apply to *stored*
  snapshots retroactively via re-scoring.
- A shop with ten benches wants one dashboard and ten cheap agents.
- The agent's attack surface stays tiny: no renderer, no auto-update channel,
  no bundled Chromium.

The cost is the loopback hop and the pairing-token step, which is the tradeoff
documented in `docs/05-device-connection-architecture.md`.

## Deployment topology (production)

```
Route 53 → CloudFront → ALB ─┬─► ECS Fargate: web  (Next.js, 2+ tasks)
                             └─► ECS Fargate: api  (NestJS, 2+ tasks)
                                      │
                          ┌───────────┼────────────┐
                          ▼           ▼            ▼
                   RDS PostgreSQL   S3 reports   Secrets Manager
                    (Multi-AZ)      (SSE-KMS)     (JWT + ENCRYPTION_KEY)
```

Details in `docs/14-production-deployment.md`.
