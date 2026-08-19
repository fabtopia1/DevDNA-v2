# 1. Architecture

## The idea

DevDNA is not a diagnostics collector that happens to print a score. It is an
**evidence system**: it observes facts, derives claims from those facts, and
concludes verdicts from those claims — keeping the three permanently distinct,
and persisting the evidence as the artifact of record.

Everything else follows from one rule:

> **A conclusion that cannot point at the observation behind it is not allowed
> to exist.**

That is enforced at runtime by the Provenance Engine, re-checked by a post-hoc
audit on every report, and asserted by the test suite across every fixture.

## Layers

```
  ┌──────────────┐
  │   capture    │  RawDeviceSnapshot from the bridge. Dumb, uninterpreted.
  └──────┬───────┘
         │  collectEvidence()  ← the only reader of a snapshot
         ▼
  ┌──────────────┐
  │   evidence   │  EvidenceRecord[] with full provenance. Facts only.
  └──────┬───────┘  ← THE PERSISTED ARTIFACT
         │
         ▼
  ┌──────────────┐
  │  inference   │  Inference[] — derived claims, each citing evidence ids.
  └──────┬───────┘
         │
         ▼
  ┌──────────────┐
  │   modules    │  Verdict[] per subject, each citing inference ids.
  └──────┬───────┘
         │
         ▼
  ┌──────────────┐
  │    trust     │  One score, one verdict, one audit trail.
  └──────────────┘
```

Each layer reads only the layer before it. Two consequences are load-bearing:

1. **No module ever reads a snapshot.** Modules are pure functions of the
   ledger, which is what makes `evaluate(ledger)` reproducible.
2. **Modules never write evidence.** Catalog expectations are seeded during
   collection. An earlier version let modules append while reading, and
   evaluation stopped being idempotent: the same ledger scored twice produced
   different audit trails.

## The seven modules

| # | Module | Question it answers | Vocabulary |
|---|---|---|---|
| 1 | **Identity** | Are the identifiers consistent with each other? | `IDENTITY_CONSISTENT` · `IDENTITY_MISMATCH` · `CANNOT_DETERMINE` |
| 2 | **Hardware Consistency** | Does the reported hardware match this model? | `SPECIFICATION_MATCH` · `SPECIFICATION_ANOMALY` · `CANNOT_DETERMINE` |
| 3 | **Service Evidence** | Is there evidence this component was replaced? | `ORIGINAL_LIKELY` · `REPLACED_LIKELY` · `CANNOT_DETERMINE` |
| 4 | **Battery Intelligence** | How worn is the cell, and when will it need replacing? | `WITHIN_SPECIFICATION` · `SERVICE_RECOMMENDED` · `DEGRADED` · `CANNOT_DETERMINE` |
| 5 | **SecurityDNA** | Is the OS intact, and what posture does a buyer inherit? | `POSTURE_CLEAN` · `POSTURE_ATTENTION` · `POSTURE_COMPROMISED` · `CANNOT_DETERMINE` |
| 6 | **Provenance** | Does every claim point at its support? | *(enforcement, not verdicts)* |
| 7 | **Trust** | What does all of it add up to? | `TRUSTED` · `TRUSTED_WITH_NOTES` · `CAUTION` · `UNTRUSTED` · `INSUFFICIENT_EVIDENCE` |

`CANNOT_DETERMINE` appears in every vocabulary because abstention is a real,
reportable outcome — never a fallback that gets rounded into a pass.

## Why Identity and Hardware are separate modules

They fail for different reasons and mean different things. Identifier
inconsistency (an IMEI that fails its own checksum) points at tampering or a
cloned identity. Hardware inconsistency (an iPhone 13 reporting an iPhone 14 Pro
logic board) points at physical substitution. A buyer's response differs: the
first is a reason to walk away, the second is a reason to open the device.

## Deployment topology

```
  Technician's bench                        DevDNA cloud
 ┌─────────────────────────┐              ┌──────────────────────────────┐
 │  iPhone ──USB──►        │   HTTPS      │   Next.js dashboard          │
 │  DevDNA Bridge          │  ◄────────►  │            │                 │
 │  (loopback :7411)       │              │            ▼                 │
 │    collect + score      │   HMAC-      │   NestJS API                 │
 │    locally              │   signed     │     collect → evaluate       │
 └─────────────────────────┘  ─────────►  │     persist evidence         │
                                          │            │                 │
                                          │            ▼                 │
                                          │   PostgreSQL   ·   S3        │
                                          └──────────────────────────────┘
```

The bridge scores locally so a shop with no internet still gets a verdict on the
bench. **The server re-scores the raw capture and stores that**, because the
bridge runs on hardware the shop controls and a shop about to sell a handset has
an obvious incentive to inflate its own number. The bridge's result is submitted
alongside, compared, and logged when it diverges — never stored.

Device connection details: [10-device-connection.md](10-device-connection.md).

## Extension without interface change

External authorities — GSX, an AASP portal, an IRP feed, an OEM API, a repair
network — integrate as **evidence adapters**. An adapter's only job is to
produce `EvidenceRecord`s; modules read the ledger and never learn where a
record came from beyond its provenance.

Concretely, a GSX adapter emits `SERVICE_RECORD_STATEMENT` records for the same
subjects and keys a technician attestation already emits, with
`EvidenceSource.OEM_SERVICE_API` at reliability 0.99. The Service Evidence rules
fire unchanged, the corroboration model treats it as an independent source and
raises confidence automatically, and no verdict vocabulary moves.

DevDNA ships **no** adapter requiring a commercial agreement. The system is
whole without one. See `packages/core/src/adapters/types.ts`.

## Repository

| Path | Contents |
|---|---|
| `packages/core/src/capture` | Snapshot type and the collectors — the only snapshot readers |
| `packages/core/src/evidence` | Evidence types and the ledger |
| `packages/core/src/inference` | Inference/verdict types and the Provenance Engine |
| `packages/core/src/confidence` | The confidence model, shared by all modules |
| `packages/core/src/modules` | The six assessment modules plus Trust |
| `packages/core/src/adapters` | The external-authority extension seam |
| `packages/core/src/catalog` | Device specs, identifier decoders, iOS trains |
| `apps/bridge` | Local USB agent and CLI |
| `apps/api` | NestJS: tenancy, ingestion, persistence, reports, audit |
| `apps/web` | Next.js dashboard, evidence drawer, public verification |

**132 tests**: 97 core, 7 bridge, 28 API end-to-end against real PostgreSQL.
