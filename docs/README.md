# DevDNA SoftwareDNA — technical documentation

SoftwareDNA is a **trust and evidence system**, not a diagnostics collector. It
observes facts, derives claims that cite those facts, and concludes verdicts
that cite those claims — keeping the three permanently distinct and persisting
the evidence as the artifact of record.

One rule generates the rest:

> A conclusion that cannot point at the observation behind it is not allowed to
> exist.

## The nine documents

| # | Document | Covers |
|---|---|---|
| 1 | [Architecture](01-architecture.md) | Layers, the seven modules, deployment topology, the adapter seam |
| 2 | [Domain model](02-domain-model.md) | Evidence, inference, verdict, finding — and why replacement ≠ authenticity |
| 3 | [Evidence model](03-evidence-model.md) | What counts as evidence, content addressing, provenance, integrity |
| 4 | [Confidence model](04-confidence-model.md) | Four levels, independent corroboration, coverage damping, the reporting threshold |
| 5 | [Scoring methodology](05-scoring-methodology.md) | Pillars, weights, gates, bands, the disclosure rule, reproducibility |
| 6 | [Audit model](06-audit-model.md) | Construction-time enforcement, post-hoc audit, the reasoning trail |
| 7 | [Database schema](07-database-schema.md) | Tables, indexes, tenancy, why evidence is rows |
| 8 | [API contracts](08-api-contracts.md) | Endpoints, auth schemes, the evidence/conclusions split |
| 9 | [Implementation roadmap](09-implementation-roadmap.md) | What is built, what is next, what is permanently out of scope |

## Supporting documents

| # | Document | Covers |
|---|---|---|
| 10 | [Device connection](10-device-connection.md) | libimobiledevice surface, what is legally reachable, the loopback boundary |
| 11 | [Security architecture](11-security-architecture.md) | Threat model, secrets, personal data, both audits |
| 12 | [Risks and limitations](12-risks-and-limitations.md) | The four hard limits, and what must never be claimed |

## PhysicalDNA

SoftwareDNA answers *is this device what it claims to be?* [PhysicalDNA](physicaldna/README.md)
answers *what condition is it in?* — from photographs, under the same
evidence-first rules, with the detector held behind an interface as a sensor
rather than a judge.

## The rules this system is built to

- Absence of evidence is never evidence of authenticity.
- `CANNOT_DETERMINE` is a first-class verdict, never a fallback.
- Low confidence downgrades trust, regardless of score.
- Raw evidence is preserved separately from every conclusion.
- Every verdict is explainable; every score is reproducible from stored evidence.
- No Apple-internal APIs, no GSX dependency, only legally obtainable data.
- Evidence, inference, verdict and confidence stay explicitly separate.
- External authorities integrate as adapters, without changing any interface.

**Read [12](12-risks-and-limitations.md) before making a commercial promise, and
[03](03-evidence-model.md) then [04](04-confidence-model.md) to understand why
the numbers mean what they mean.**
