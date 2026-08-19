# DevDNA SoftwareDNA — technical blueprint

| # | Document | Covers |
|---|---|---|
| 1 | [System architecture](01-system-architecture.md) | Components, trust boundaries, the two-scoring rule, data flow |
| 2 | [Database schema](02-database-schema.md) | Tables, indexes, tenancy, retention |
| 3 | [Backend architecture](03-backend-architecture.md) | Modules, guards, ingestion, privacy at write time |
| 4 | [Frontend architecture](04-frontend-architecture.md) | Rendering model, session handling, CSP, bridge client |
| 5 | [Device connection architecture](05-device-connection-architecture.md) | libimobiledevice surface, what is reachable, loopback boundary, bridge auth |
| 6 | [SoftwareDNA engine](06-softwaredna-engine.md) | Provenance model, parsers, provider chains |
| 7 | [Parts verification engine](07-parts-verification-engine.md) | Detectors, rule engine, thresholds, roadmap to ground truth |
| 8 | [Trust score algorithm](08-trust-score-algorithm.md) | Weights, confidence damping, gates, worked examples |
| 9 | [API specification](09-api-specification.md) | Endpoints, auth schemes, conventions |
| 10 | [Security architecture](10-security-architecture.md) | Threat model, secrets, personal data, audit |
| 11 | [Folder structure](11-folder-structure.md) | Layout and the reasoning behind it |
| 12 | [MVP roadmap](12-mvp-roadmap.md) | What is built, what is next, exit criteria |
| 13 | [Testing strategy](13-testing-strategy.md) | 82 tests, what they pin down, and the gaps |
| 14 | [Production deployment](14-production-deployment.md) | AWS topology, migrations, secrets, bridge distribution |
| 15 | [Risks and limitations](15-risks-and-limitations.md) | The four hard limits, and what must never be claimed |

**Start with [15](15-risks-and-limitations.md) if you are about to make a
commercial promise, and [07](07-parts-verification-engine.md) if you want to
understand what makes this product hard.**
