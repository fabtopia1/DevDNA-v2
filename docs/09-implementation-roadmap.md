# 9. Implementation roadmap

## Where this stands

Built and passing **185 tests** (97 core, 47 PhysicalDNA, 7 bridge, 34 API
end-to-end against real PostgreSQL):

| Layer | State |
|---|---|
| Evidence ledger, content addressing, digest, integrity check | complete |
| Provenance Engine — construction-time enforcement and post-hoc audit | complete |
| Confidence model — four levels, independent-source corroboration | complete |
| Six assessment modules + Trust Engine | complete |
| Adapter interface for external authorities | complete, no adapter shipped |
| Bridge — libimobiledevice wrapper, device watcher, signed upload, CLI | complete |
| API — tenancy, HMAC ingestion, evidence persistence, re-scoring, PDF, public verify | complete |
| Web — dashboard, inspection flow, evidence drawer, public verification | complete |
| Reproducibility test: report recomputed from stored evidence is deep-equal | passing |

What is *not* built is deliberate, and is what the phases below address.

## Phase 1 — Field validation (weeks 1–6)

The engine reasons correctly about the evidence it is given. The open question
is whether the evidence is what real handsets produce.

- Run against 500+ real devices across iOS 15–18 and iPhone 8 → 16 Pro Max, in
  two or three partner shops.
- **Measure abstention rate per module per iOS train.** This is the primary
  metric of the phase. A module abstaining more than expected on a train means
  a collector needs work, not that the devices are unusual.
- Calibrate `CHANNEL_RELIABILITY` against observed disagreement between
  channels, rather than against the current conservative estimates.
- Validate `hardware-specs.ts` board ids and design capacities against measured
  values; the catalog is the one place where a wrong constant produces a
  confident wrong answer.
- Ship the IORegistry parser variants that iOS 18 needs.

Exit criteria: abstention rate under 20% for Identity, Hardware and Security on
supported trains; zero provenance violations across the whole corpus; no fixture
regression.

## Phase 2 — Parts and Service History capture (weeks 4–10)

The highest-value evidence in the system currently arrives by technician
attestation at reliability 0.70. Raising that is the single biggest confidence
improvement available.

- Guided capture flow: photograph the Settings screen, OCR, technician confirms
  each line. Records land as `HUMAN_ATTESTATION` corroborated by
  `OCR_EXTRACTION` — two genuinely independent channels, so noisy-OR raises
  confidence honestly.
- Structured `SERVICE_RECORD_STATEMENT` vocabulary for every label iOS emits, in
  every localisation the partner shops see.
- Component coverage expansion: LiDAR, speakers, microphone, Taptic Engine are
  modelled and weighted but rarely evidenced today.

This phase must not change a single rule in `service.ts`. If it does, the
adapter seam is wrong.

## Phase 3 — Fleet intelligence (weeks 8–14)

Evidence is stored as queryable rows precisely so this phase is a reporting
problem rather than a re-architecture.

- Cross-tenant anonymised baselines: expected wear rate per model per region,
  used to flag a battery whose reported health is inconsistent with its cycle
  count. Anonymised means anonymised — the per-tenant `identifierSalt` exists so
  that no baseline can confirm which shop handled which handset.
- Duplicate-identifier detection across tenants (the same IMEI inspected in two
  places with different hardware evidence) as an `IDENTITY` rule, on hashes
  only.
- Collector health monitoring: alert when a channel's failure rate moves,
  because that is how an upstream change first shows itself.

## Phase 4 — External authority adapters (weeks 12–20)

Only once a commercial agreement exists. The interface is already in place, and
the work is an adapter plus credentials — not an engine change.

```
GSX adapter        → SERVICE_RECORD_STATEMENT, EvidenceSource.OEM_SERVICE_API,     reliability 0.99
AASP portal        → SERVICE_RECORD_STATEMENT, EvidenceSource.OEM_SERVICE_API,     reliability 0.97
IRP feed           → SERVICE_RECORD_STATEMENT, EvidenceSource.REPAIR_NETWORK,      reliability 0.90
Carrier lock / IMEI blocklist → DEVICE_PROPERTY, EvidenceSource.REPAIR_NETWORK
```

Each emits the same kinds against the same subjects and keys the engine already
consumes. The Service Evidence rules fire unchanged; corroboration treats each
as an independent source and raises confidence automatically.

**DevDNA must remain whole with none of them connected.** A trust layer that
only works for the licensed is not a trust layer for the industry, and the
"no GSX dependency" rule is a product constraint, not a temporary one.

## Phase 5 — Verification as an asset (weeks 16–24)

- Signed report attestations: sign the ledger digest with an org key, so a
  buyer can verify a report offline.
- Device history across owners: the same handset inspected by a wholesaler and
  then a retailer, with each party seeing only their own evidence but both
  seeing that a prior inspection exists.
- Marketplace API: a listing site queries a `publicId` and renders the verdict
  natively.
- Warranty and insurance underwriting: the coverage figure, not the score, is
  what an underwriter needs — which is why the two were never merged.

## Explicitly out of scope

Some of these are permanent constraints, not deferred items:

- **Anything requiring jailbreak, exploit, or unauthorised Apple access.** The
  system is built on public frameworks, documented pairing, and libimobiledevice
  precisely so it is legally deployable in every market at once.
- **Android.** The evidence model generalises; the collectors and the entire
  service-history reasoning do not.
- **Claiming a repair occurred without direct evidence.** No amount of
  circumstantial signal will be permitted to produce `REPLACED_LIKELY` on its
  own, and no absence of signal will ever produce `ORIGINAL_LIKELY`.
- **A fourth service verdict.** Three values, one of which is
  `CANNOT_DETERMINE`. A "probably original" hedge would be used as a pass.

## Engineering practices carried forward

- Every new rule ships with a fixture that exercises it and an assertion that
  `provenanceViolations` stays empty.
- Every scoring change bumps `TRUST_ALGORITHM_VERSION`; historical inspections
  keep the version that produced them.
- Reproducibility is a test, not a claim: a report recomputed from persisted
  evidence must stay deep-equal to the original, audit trail included.
- Calibration changes to `CHANNEL_RELIABILITY` require the field data that
  motivated them to be recorded in the commit message.
