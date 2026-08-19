# 7. Parts verification engine

This is the module the product exists for, and the one where being honest about
limits matters most.

## The problem, stated accurately

Since iOS 15.2 Apple shows **Parts and Service History** under
Settings › General › About, labelling components as *Genuine Apple Part*,
*Used Apple Part*, or *Unknown Part*. It is exactly what a refurbisher needs.

**Apple exposes no public API, lockdown domain, or USB service that returns
it.** It is rendered on-device only. Any vendor claiming to read it directly
over USB is either using Apple-internal tooling (which we will not do), or
inferring it from signals and not saying so.

DevDNA infers it from signals *and says so*, on every verdict, with a
confidence number and the evidence attached.

## Architecture: detectors produce evidence, a rule engine decides

```
   snapshot
      │
      ├─► attestationDetector      ─┐
      ├─► analyticsDetector         │
      ├─► batteryHardwareDetector   ├─►  PartSignal[]  ─►  rule engine  ─►  PartResult[]
      ├─► capabilityDetector        │                       (per component)
      └─► (future: gsxDetector)    ─┘
```

A **detector** turns one collection surface into zero or more `PartSignal`s.
A detector never decides a verdict. The **rule engine** never reads a snapshot.
That split is what makes the module survive Apple changing things: a new
evidence source is a new detector, and a shifted threshold is a constant.

Every signal carries:

```ts
{ component, polarity, source, strength, confidence, summary, evidence? }
```

`strength` is how strongly this evidence points in its direction;
`confidence` is how much the reading itself should be believed. They are
separate because a *very* strong indicator read from a *flaky* source is not
the same as a weak indicator read reliably.

## The four MVP detectors

### 1. `attestationDetector` — Apple's own verdict, transcribed

The technician reads the Parts & Service History screen and enters it (or
OCRs a screenshot). This is the only source carrying Apple's actual answer, so
it is the strongest signal available without an Apple contract:
`strength 0.95`, `confidence 0.7` (manual) / `0.6` (OCR).

It is modelled as a *high-strength signal*, not as ground truth, precisely
because a human read a screen — transcription slips and OCR misreads stay
visible in the confidence number rather than being laundered into certainty.

**Absence is also evidence.** iOS renders no Parts & Service History section at
all when it holds no service record. On a model that supports the screen
(iPhone XR/XS and later), `sectionAbsent: true` yields moderate
`SUPPORTS_GENUINE` signals for display, battery and rear camera.

### 2. `analyticsDetector` — the device's own diagnostic record

Aggregated analytics files (`log-aggregated-*.ips`), pulled over the public
`com.apple.crashreportcopymobile` service, contain traces of component pairing
failures. DevDNA matches a **data-driven** pattern table:

| Pattern | Component | Polarity | Strength |
|---|---|---|---|
| `AppleSmartBatteryUnknownPart` | Battery | non-genuine | 0.85 |
| `NonGenuineBattery` | Battery | non-genuine | 0.85 |
| `AppleDisplayPipeAuthFailure` | Display | non-genuine | 0.75 |
| `DisplaySerialMismatch` | Display | transplanted | 0.70 |
| `MultitouchCalibrationFailure` | Display | non-genuine | 0.50 |
| `TrueToneDisabled` | Display | transplanted | 0.45 |
| `FaceIDPairingFailure` / `PearlNotPaired` | Face ID | non-genuine | 0.80 |
| `CameraPairingFailure` | Rear camera | non-genuine | 0.70 |
| `ServiceHistoryRecord` | Logic board | serviced | 0.40 |

Weaker than an attestation — files can be stale, and absence proves nothing —
but **fully automatic**, which makes it the backbone of an unattended
inspection. Apple does not document this schema and reshapes it between
releases, so both the key aliases and the pattern table are **data, not code**:
a schema shift is a config change.

Files are copied to a temp directory, scanned, and deleted. DevDNA never
retains a customer's raw analytics.

### 3. `batteryHardwareDetector` — cell identity

From the `AppleSmartBattery` IORegistry node:

- A well-formed cell serial ≥ 8 chars → weak `SUPPORTS_GENUINE` (0.40)
- No serial while the registry is otherwise readable → `SUPPORTS_UNKNOWN` (0.45)
- `DesignCapacity` outside 800–6000 mAh — a figure no iPhone cell has — →
  `SUPPORTS_UNKNOWN` (0.60)
- `BatteryInstalled == false` → `SUPPORTS_UNKNOWN` (0.70)

### 4. `capabilityDetector` — functional probes

True Tone requires the panel's factory calibration data, which does not travel
with a third-party or transplanted display. A model that *shipped* with True
Tone but reports it unsupported has almost always had its panel replaced
(`SUPPORTS_USED`, 0.60). Likewise a Face ID model reporting no Face ID
capability (`SUPPORTS_UNKNOWN`, 0.70).

## The rule engine

Signals are accumulated into polarity masses, each weighted `strength × confidence`:

```
mass.unknown, mass.used, mass.genuine, mass.serviced, mass.total
share(x) = x / mass.total
```

Decision order — and the order itself is a product decision:

1. **No signals at all → `CANNOT_DETERMINE`.** We never conclude "genuine" from
   silence. Absence of evidence is not evidence of authenticity; this single
   rule is what stops the product from becoming a rubber stamp.
2. Total mass below `0.25` → `UNVERIFIED_PART`.
3. `share(unknown) ≥ 0.42` → **`UNKNOWN_PART`**
4. `share(used) ≥ 0.45` → **`USED_APPLE_PART`**
5. `share(genuine) ≥ 0.55` → **`GENUINE_APPLE_PART`**
6. Otherwise → `UNVERIFIED_PART` (evidence conflicts)

`UNKNOWN` has the **lowest** threshold and `GENUINE` the **highest**. That
asymmetry is intentional: for a trade buyer, a missed non-genuine display costs
far more than an over-cautious flag.

Confidence scales with both one-sidedness and total mass
(`share × min(mass/1.2, 1)`), so a single weak signal never yields a confident
verdict.

## Scoring

```
VERDICT_SCORE = { GENUINE 100, USED 72, UNVERIFIED 55, UNKNOWN 12,
                  CANNOT_DETERMINE null, NOT_APPLICABLE null }
```

Component weights reflect what the resale market actually prices:

| Component | Weight | | Component | Weight |
|---|---|---|---|---|
| Display | 0.24 | | Front camera | 0.09 |
| Battery | 0.18 | | Touch ID | 0.06 |
| Face ID | 0.14 | | Rear housing | 0.05 |
| Rear camera | 0.13 | | LiDAR / speaker / mic | 0.03 |
| Logic board | 0.10 | | Taptic engine | 0.02 |

`partsScore` is the weighted mean over components with a scoreable verdict.
`CANNOT_DETERMINE` components are **excluded from the mean and counted against
coverage** — they neither help nor hurt the score, they reduce how much the
score is worth.

```
coverage   = Σ weight(determinable) / Σ weight(applicable)
confidence = meanVerdictConfidence × (0.35 + 0.65 × coverage)
```

Coverage is a first-class multiplier, not a footnote: a perfect score across
10% of the device tells a buyer nothing, and the trust engine caps the final
score accordingly.

Component applicability is per model — Face ID is `NOT_APPLICABLE` on an SE,
LiDAR only on Pro models — so an SE is never penalised for lacking hardware it
never had.

## Roadmap beyond the MVP

| Phase | Addition | Effect |
|---|---|---|
| 2 | OCR of the Parts & Service History screenshot | Removes transcription error, raises attestation confidence toward 0.85 |
| 2 | Expanded analytics pattern corpus, built from labelled real-device captures | Raises automatic coverage, the weakest MVP number |
| 3 | **GSX adapter** (Apple Authorized Service Provider API) | Ground truth. Requires an Apple AASP contract — a commercial step, not a technical one. Slots in as a detector with `AUTHORIZED_SERVICE_API` at confidence 1.0. |
| 3 | Fleet-calibrated thresholds | Tune from outcomes across real inspections rather than from first principles |

The interface does not change when GSX arrives. That is the point of the
detector/rule split.
