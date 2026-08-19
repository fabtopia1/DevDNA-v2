# 11. Folder structure

```
DevDNA-v2/
├── package.json                   pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json             shared strict TS config
├── docker-compose.yml             local stack: postgres + api + web
├── .env.example                   annotated environment reference
│
├── docs/                          the technical blueprint (this set)
│
├── infra/
│   ├── api.Dockerfile             multi-stage, non-root, healthchecked
│   └── web.Dockerfile
│
├── packages/
│   └── core/                      @devdna/core — the domain. Pure, deterministic.
│       ├── src/
│       │   ├── types/             common (Observation, DataSource, Finding),
│       │   │                      device, battery, software, parts, inspection
│       │   ├── catalog/           devices, regions, iOS release trains
│       │   ├── parsers/           plist, ideviceinfo, ioregistry, analytics
│       │   ├── engines/
│       │   │   ├── identity.ts
│       │   │   ├── battery.ts     provider chain + scoring curves
│       │   │   ├── software.ts
│       │   │   ├── parts/
│       │   │   │   ├── signals.ts detectors (evidence producers)
│       │   │   │   └── index.ts   rule engine (verdict decider)
│       │   │   ├── trust.ts       damping, gates, banding
│       │   │   └── inspection.ts  orchestrator
│       │   ├── fixtures/          five deterministic device profiles
│       │   └── util/hash.ts       salted hashing, HMAC sign/verify
│       └── test/                  53 tests
│
└── apps/
    ├── bridge/                    @devdna/bridge — the local USB agent
    │   ├── src/
    │   │   ├── adapters/
    │   │   │   ├── exec.ts               execFile wrapper + UDID validation
    │   │   │   └── libimobiledevice.ts   typed tool wrapper
    │   │   ├── services/
    │   │   │   ├── collector.ts          snapshot collection, partial-tolerant
    │   │   │   ├── device-watcher.ts     usbmux polling + events
    │   │   │   ├── uploader.ts           HMAC-signed cloud ingest
    │   │   │   └── local-token.ts        per-install pairing token
    │   │   ├── server.ts                 loopback HTTP + WebSocket
    │   │   ├── cli.ts                    serve / devices / inspect / doctor
    │   │   └── config.ts
    │   └── test/                  7 tests
    │
    ├── api/                       @devdna/api — NestJS
    │   ├── prisma/
    │   │   ├── schema.prisma
    │   │   ├── migrations/
    │   │   └── seed.ts            demo tenant, engine-generated inspections
    │   ├── src/
    │   │   ├── config/configuration.ts
    │   │   ├── common/            core.module, prisma, audit, crypto,
    │   │   │                      decorators, guards/
    │   │   ├── modules/
    │   │   │   ├── auth/  bridges/  inspections/
    │   │   │   ├── reports/       reports.service.ts + pdf-report.ts
    │   │   │   ├── devices/  dashboard/  health/
    │   │   └── main.ts
    │   └── test/api.e2e.test.ts   22 end-to-end tests
    │
    └── web/                       @devdna/web — Next.js 15
        └── src/
            ├── app/
            │   ├── (app)/         authenticated shell
            │   │   ├── dashboard/  inspections/  inspections/[id]/
            │   │   ├── inspect/    settings/
            │   ├── login/
            │   ├── verify/[publicId]/       public report verification
            │   └── api/                     auth handlers, allowlisted proxy
            ├── components/        inspect-flow, report-button,
            │                      pair-workstation, ui/primitives
            ├── lib/               api, session, bridge-client, format, types
            └── middleware.ts      auth gate + per-request nonce CSP
```

## Why this shape

**`packages/core` is the product.** Parsers, scoring and verdict logic live in
one pure, dependency-free package that both the bridge and the API import. That
is what makes the two-scoring rule (`docs/01`) possible without duplicating
logic, and what makes 53 fast unit tests meaningful.

**Detectors are separated from the rule engine** inside `engines/parts/`. Apple
will change what it exposes; the split means a new evidence source is a new
file in `signals.ts` and nothing else moves.

**Fixtures ship in `core`, not in test folders**, because they are used by the
bridge simulator, the database seed and three test suites. If they lived under
`test/` the simulator could not import them, and demo mode would drift into a
separate code path.

**The bridge is an app, not a package**, because it is a deployable artifact
with its own CLI and installer story, not a library.
