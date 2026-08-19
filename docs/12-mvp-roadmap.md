# 12. MVP development roadmap

## Phase 0 — what is built and running

Everything below is implemented, tested and verified end to end in this
repository.

| Area | Status |
|---|---|
| Inspection engine (identity, battery, software, parts, trust) | **Done** — 53 tests |
| libimobiledevice bridge + loopback API + simulator | **Done** — 7 tests |
| NestJS API: tenancy, auth, ingest, reports, dashboard, audit | **Done** — 22 e2e tests against real PostgreSQL |
| Next.js dashboard, inspection flow, evidence view, public verification | **Done** — verified in Chromium |
| PDF report with QR verification | **Done** |
| Docker Compose, Dockerfiles, seed data | **Done** |

Verified paths: sign in → pair workstation → detect device → run inspection →
signed ingest → server re-score → evidence view → PDF → public verification.

## Phase 1 — first ten shops (weeks 1–6)

The goal is not more features. It is **field-validating the parts engine**,
which is the only part built from first principles rather than from data.

| Week | Work | Why |
|---|---|---|
| 1–2 | Windows installer bundling libimobiledevice; signed macOS `.pkg` | Shops will not install iTunes to use this |
| 1–2 | Capture programme: 200+ real device snapshots with a technician-confirmed Parts & Service History screenshot | The labelled dataset the engine currently lacks |
| 3–4 | Tune `DIAGNOSTIC_SIGNAL_RULES` and verdict thresholds against that dataset; publish precision/recall per component | Move the parts engine from principled to evidence-based |
| 3–4 | OCR the attestation screenshot | Removes transcription error; raises attestation confidence |
| 5 | Customer records on inspections; CSV export | Every shop asked for it before they asked for anything else |
| 5–6 | Bridge auto-update channel; crash reporting | Ten benches is already too many to update by hand |
| 6 | Ed25519 replacing HMAC for bridge auth | Removes the server's ability to forge a bridge submission |

**Phase 1 exit criteria**
- Parts verdict precision ≥ 0.95 on the labelled set for display and battery.
- Median parts coverage ≥ 0.6 **without** an attestation.
- Zero cross-tenant incidents; zero reports issued from an INCONCLUSIVE
  inspection.

## Phase 2 — commercial product (months 2–4)

| Work | Notes |
|---|---|
| **GSX adapter** | Ground truth for Parts & Service History. The blocker is an Apple AASP contract — commercial, not technical. Slots in as a detector. |
| Billing (Stripe), plan limits | |
| Public API + API keys | Buyback platforms want to trigger inspections programmatically |
| Webhooks | `inspection.completed`, `inspection.flagged` |
| Bulk mode | Refurb lines inspect 200 handsets a shift; one bridge, many benches |
| Report branding | Shop logo, terms, custom disclaimers |
| Fleet analytics | "Third-party display rate by supplier" is the report a refurbisher will pay for |

## Phase 3 — the trust layer (months 4–12)

| Work | Notes |
|---|---|
| Cross-tenant device history (privacy-preserving) | "This IMEI was inspected 3 times in 6 months, scores declining" — needs consent architecture and careful design against the competitor threat in `docs/10` |
| Marketplace integrations | Back Market, Swappa, eBay Refurbished |
| Insurer / warranty grading API | |
| Android (Samsung Knox attestation, Google Play Integrity) | A different engine entirely; deliberately out of MVP scope |
| Re-scoring campaigns | Improve the engine, re-score historical snapshots, show shops what changed |

## Explicit non-goals for the MVP

- **Android.** The verification primitives are unrelated.
- **Hardware diagnostics** (touch, speaker, camera capture tests). Valuable,
  but it is a different product surface and would dilute the trust claim.
- **Anything requiring Apple-internal tooling.** Non-negotiable; it would make
  the product undeployable and unsellable.
