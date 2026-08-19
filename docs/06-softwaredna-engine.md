# 6. SoftwareDNA inspection engine

`packages/core` — pure, synchronous, dependency-free (except `node:crypto`).
The same snapshot always produces the same result under the same engine
version. That determinism is what makes an inspection auditable, testable and
re-scorable.

`ENGINE_VERSION = 1.0.0`, persisted on every inspection.

## The provenance model

Every fact is an **observation**, never a bare value:

```ts
interface Observation<T> {
  value: T;
  source: DataSource;      // where it physically came from
  confidence: number;      // 0..1, how much to believe this reading
  observedAt: string;
  note?: string;           // shown in the UI evidence drawer
}
```

A verification product that cannot say where a number came from, and how much
it should be believed, is not a verification product. Consumers are expected to
surface `source` and `confidence` — the dashboard and PDF both do.

Baseline source confidence:

| Source | Base |
|---|---|
| `AUTHORIZED_SERVICE_API` (GSX, future) | 1.00 |
| `LOCKDOWN` | 0.98 |
| `LOCKDOWN_DOMAIN` | 0.95 |
| `DIAGNOSTICS_RELAY` | 0.92 |
| `MOBILEGESTALT` / `INSTALLATION_PROXY` | 0.90 |
| `SERVICE_DISCOVERY` | 0.85 |
| `DERIVED` | 0.80 |
| `ANALYTICS_LOG` | 0.72 |
| `TECHNICIAN_ATTESTATION` | 0.70 |
| `ATTESTATION_OCR` | 0.60 |

## Pipeline

```
RawDeviceSnapshot
   ├─► assessIdentity   → DeviceIdentity      (catalog + region + activation)
   ├─► assessBattery    → BatteryAssessment   (provider chain)
   ├─► assessSoftware   → SoftwareAssessment  (currency, storage, integrity)
   ├─► assessParts      → PartsAssessment     (detectors + rule engine)
   └─► assessTrust      → TrustAssessment     (damping + gates + banding)
                              ↓
                        InspectionResult  (+ deduped, severity-sorted findings)
```

## Parsers

- **`plist.ts`** — a dependency-free XML plist reader. Every libimobiledevice
  tool can emit XML plist, so one parser covers the whole collection surface.
  `<data>` is surfaced as base64 text so snapshots stay JSON-serialisable end
  to end — they are persisted verbatim. Binary plists are deliberately out of
  scope; the tools do not produce them.
- **`ideviceinfo.ts`** — auto-detects XML vs `Key: Value`. Integers beyond the
  safe range stay strings rather than silently losing precision.
- **`ioregistry.ts`** — normalises `AppleSmartBattery`, unwrapping the three
  envelope shapes different builds return, and converting deci-Celsius.
- **`analytics.ts`** — tolerant deep-walk extractor over `.ips` payloads with
  an **alias table**, because Apple does not document this schema and reshapes
  it between releases. A schema shift is a config change, not a code change.
  Never throws on malformed input.

## Identity

Product type → marketing name, generation, release year, rated cycle life,
biometrics, camera count and max supported iOS, from a data-driven catalog.

**Unknown product types degrade gracefully.** A model released after the
catalog was published returns `recognised: false` and a conservative synthetic
entry — `"iPhone (iPhone19,4)"` — rather than a guessed marketing name.
Downstream engines lower confidence instead of asserting something false about
hardware they do not know.

Region codes resolve through a lookup that returns `null` for unmapped codes
rather than inventing a country. Marketing capacity is snapped up from raw
`TotalDiskCapacity` to the nearest tier.

Activation Lock has no guaranteed lockdown key. Where `com.apple.fmip` answers
we use it; otherwise the field stays `null` — *could not be determined* — and
the trust engine raises a manual-check finding. We never infer Activation Lock
from an activated device: a device can be both.

## Battery: a provider chain

| Priority | Provider | Yields | Confidence |
|---|---|---|---|
| 1 | `DIAGNOSTICS_RELAY` IORegistry | design capacity, nominal charge capacity, cycle count, cell serial | 0.92 |
| 2 | `ANALYTICS_LOG` | same fields, from aggregated analytics | 0.72 |
| 3 | `LOCKDOWN_DOMAIN` | current charge only — never a health metric | 0.95 |

The first provider yielding a usable value for a field wins, and the winner's
identity travels into the report, so a buyer can see whether a health figure
came from the device's own registry or from an analytics file.

Maximum Capacity is computed Apple's way when not directly reported:
`NominalChargeCapacity / DesignCapacity`, tagged `DERIVED`.

When no health source answers, `confidence` is **0** and findings tell the
technician exactly what to do: read Maximum Capacity from Settings › Battery
and attach it as an attestation. The engine does not invent a number.

## Software

Version currency is measured against the newest train the **device** supports,
not the newest that exists — an iPhone 8 on 16.7.11 is current and is not
penalised. Integrity heuristics look for known jailbreak bundle identifiers and
the `com.apple.afc2` service that stock iOS never advertises; a positive here
caps the whole trust score, because a modified system can falsify every other
value in the pipeline.

Software confidence counts whether the diagnostics relay answered. If it stayed
silent, our view of the software state genuinely is less complete.

## Parts and trust

See `docs/07-parts-verification-engine.md` and
`docs/08-trust-score-algorithm.md`.

## Fixtures

`packages/core/src/fixtures` ships five deterministic profiles: pristine
iPhone 15 Pro, Apple-serviced 14 Pro, third-party-parts 13, activation-locked
12, and a minimal-data iPhone 8. They are ordinary `RawDeviceSnapshot` values,
so the bridge simulator, the seed data and the test suite all exercise **the
same engine path** as a real USB capture. There is no "demo mode" branch
anywhere in the engines.
