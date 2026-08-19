# 15. Risks and technical limitations

This document exists because a verification product that oversells its
certainty is worse than no product. Everything below should be read by anyone
about to make a commercial promise on DevDNA's behalf.

## The four hard technical limits

### 1. Parts & Service History has no public API

Apple renders it on-device only. There is no lockdown domain, USB service or
public endpoint that returns it.

**Impact.** Component verdicts are *inferred* from signals unless a technician
transcribes Apple's screen. Automatic coverage — the share of component weight
DevDNA can assess with no human step — is the weakest number in the product.

**Mitigation.** Detector architecture with explicit confidence and coverage; a
technician attestation path that carries Apple's own wording; `CANNOT_DETERMINE`
as a first-class verdict; coverage caps on the trust score. Phase 3's GSX
adapter is ground truth, and its blocker is an Apple AASP contract — commercial,
not technical.

**Never do.** Present an inferred verdict as Apple's verdict. The UI and the PDF
both name the source of every signal for exactly this reason.

### 2. Battery health and cycle count are increasingly restricted

They live in the `AppleSmartBattery` IORegistry node, reached via
`com.apple.mobile.diagnostics_relay`. Apple has progressively restricted that
service on newer iOS builds.

**Impact.** On many modern handsets the primary source refuses, and DevDNA falls
back to aggregated analytics files — lower fidelity, and absent entirely if the
customer has analytics sharing disabled or the device was recently erased. When
both fail, battery confidence is **0** and the inspection usually lands
`INCONCLUSIVE`.

**Mitigation.** Explicit provider chain, honest confidence, findings that tell
the technician to read Settings › Battery and attach an attestation.

**Trajectory risk.** This is the limit most likely to get *worse*. A future iOS
could close the analytics path too, at which point battery health becomes
attestation-only. The provider chain is designed so that is a configuration
outcome, not a rewrite.

### 3. Analytics schema is undocumented and unstable

Apple reshapes `.ips` payloads between releases without notice.

**Mitigation.** The extractor deep-walks arbitrary JSON and matches **alias
tables**, so a schema shift is a config change. It is asserted never to throw on
malformed input. But a renamed key silently reduces coverage rather than
erroring — which is why the **fleet coverage rate is a monitored metric**, not
just a per-inspection number. A sudden drop across many devices is the signal
that Apple changed something.

### 4. A jailbroken device can lie about everything

Every value DevDNA reads comes from the device's own operating system.

**Mitigation.** Known-bundle-ID and `com.apple.afc2` detection, a −45 software
penalty, a hard cap of 40 on trust, and a `CRITICAL` finding.

**Honest framing.** This is *detection*, not prevention. A sufficiently
determined adversary with a jailbroken handset can defeat it. DevDNA raises the
cost of fraud; it does not make fraud impossible, and no USB-based tool can.

## Product and commercial risks

| Risk | Likelihood | Impact | Response |
|---|---|---|---|
| **Apple closes the diagnostics relay entirely** | Medium | High | Provider chain already degrades; accelerate GSX |
| **Apple objects to trademark usage** | Medium | Medium | Report and UI carry an explicit non-affiliation disclaimer; counsel review before launch |
| **Parts thresholds are miscalibrated** | **High** | **High** | The most important open question. Built from first principles, not data. Phase 1's labelled capture programme and published precision/recall exist to close it. |
| **A shop disputes a flagged verdict** | High | Medium | Every verdict carries its evidence and confidence; snapshots are retained; inspections are re-scorable and auditable |
| **Bridge install friction kills adoption** | Medium | High | Bundled, signed installers; `devdna-bridge doctor`; simulator mode for evaluation without hardware |
| **A cross-tenant leak** | Low | **Existential** | Structural tenancy, per-tenant salts, e2e tests asserting isolation |

## Known implementation gaps

Stated plainly rather than buried:

| Gap | Status |
|---|---|
| No automated frontend test suite | Flow verified manually in Chromium; Playwright specs are Phase 1 |
| Bridge auth is symmetric HMAC | The API could in principle forge a bridge submission. Ed25519 is planned and the canonical string is already scheme-agnostic |
| Reports stored on local disk | S3 swap is one function (`resolveStoragePath`) |
| No accessibility audit | Colour-independent verdicts and semantic markup are in place; an axe pass has not been run |
| Device catalog ends at iPhone 16e | Newer models degrade to `recognised: false` rather than a wrong name — correct behaviour, but the catalog needs a refresh cadence |
| No background job runner | Nonce pruning and catalog sync exist as methods without a scheduler |
| Bridge tested against fixtures, not real hardware | The adapter's parsing of real tool output is covered by documented formats only |

## What DevDNA should never claim

1. That it reads Apple's Parts & Service History directly. It does not.
2. That a `VERIFIED` result guarantees authenticity. It states that the
   available evidence, at the stated confidence, supports it.
3. That it can detect every non-genuine component. Coverage is measured and
   reported precisely because it is incomplete.
4. That it is an Apple product, or endorsed by Apple. It is neither.

The report footer says all four, in words, on every PDF. That is not legal
throat-clearing — it is the product's actual value proposition. A trade buyer
who learns DevDNA overstates its certainty will stop trusting the number, and
the number is the entire business.
