# 8. Integration with SoftwareDNA

## Two scores, deliberately

| | SoftwareDNA | PhysicalDNA |
|---|---|---|
| Question | Is this device what it claims to be? | What condition is it in? |
| Evidence | Device OS, registries, service records | Photographs |
| Output | Trust score, 0–100 | PhysicalDNA score, 0–100 |
| Failure mode | Fraud, tampering, undisclosed service | Wear, damage, breakage |

**Cosmetic condition never moves the trust score.** A scratched handset is not a
less trustworthy handset, and a number that mixes the two means neither. The
report shows both, side by side, and never averages them.

## The one route from a photograph to trust

13 taxonomy classes are marked `trustRelevant`: non-OEM screws, pry marks,
adhesive residue, panel gaps, finish mismatch, internal camera debris, missing
lens ring, a triggered liquid indicator, delamination, panel separation,
corrosion.

These are not condition observations. They are **evidence the device has been
opened or altered** — which is precisely the question the Service Evidence
Engine already answers, from Parts & Service History and OEM records.

So they flow there, as an additional independent source:

```
photograph → NON_OEM_SCREW detection → evidence record
                                          │
                                          ▼
                            Service Evidence Engine
                     "a replacement screw is fitted, so the
                      device has been opened"
                                          │
                                          ▼
                              trust score (unchanged mechanism)
```

This is the corroboration model doing real work. A device whose Parts & Service
History is silent but whose bottom edge shows two Phillips screws now has
**two independent sources** disagreeing about whether it was serviced — and
noisy-OR across independent sources is exactly how SoftwareDNA already reasons.
Physical evidence is the first source that can contradict the device's own
account of itself.

The module surfaces them for that purpose:

```ts
detail.repairIndicators: Array<{ classId, surface, evidenceId }>
```

**Status: the indicators are identified, evidenced and exposed. Wiring them into
`service.ts` is deliberately deferred to Phase 4** — the rule is only worth
adding once the classes behind it have measured precision, because a
false-positive non-OEM screw would move a *trust* verdict, which is far more
damaging than moving a condition grade.

## One ledger, one report

Physical evidence lands in the same `EvidenceLedger`, under the same provenance
rules, read by the same Provenance Engine. Adding it required five vocabulary
entries and no new machinery:

```
EvidenceKind      + VISUAL_OBSERVATION, IMAGE_QUALITY_METRIC
EvidenceSource    + DEVDNA_VISION_MODEL, DEVDNA_CAPTURE_PIPELINE
CollectionMethod  + VISION_MODEL_DETECTION, IMAGE_QUALITY_ANALYSIS,
                    GUIDED_PHOTO_CAPTURE
EvidenceSubject   + FRAME, CHARGE_PORT
ModuleId          + PHYSICAL_CONDITION
```

Front glass and rear glass got **no new subjects**. They are the outward faces of
`DISPLAY` and `REAR_HOUSING`, which already exist — and keeping them joined is
what lets one line of a report carry both verdicts about the same part:

```
Display    REPLACED_LIKELY  [genuine apple]     ← SoftwareDNA
           SURFACE_DAMAGED  structural crack    ← PhysicalDNA
```

That join is only possible because the two engines share a subject vocabulary. It
is the single most valuable thing the integration buys, and it would have been
lost by giving PhysicalDNA its own surface enum.

## Combined report

```
DevDNA Verification Report

SoftwareDNA
  Trust Score          95/100   TRUSTED_WITH_NOTES
  Confidence           76%      Coverage 85%

PhysicalDNA
  Overall Condition    Excellent
  PhysicalDNA Score    93/100
  Confidence           95%      Coverage 100%

  Findings:
    - Minor scratch on lower frame
    - No front glass damage
    - Camera module intact
    - Rear glass intact
```

Two scores, each with its own confidence and coverage, never averaged into a
single figure. A buyer needs to know *"sound provenance, cosmetically worn"* and
*"pristine but undisclosed screen replacement"* are different devices.

## Database

`ModuleId.PHYSICAL_CONDITION` and the two new subjects were added by migration
`20260820000441_physicaldna_vocabulary`. Physical evidence, inferences and
verdicts persist through the **existing** `evidence_records`, `inferences` and
`module_verdicts` tables — no new tables, and every existing query, index and
audit path applies unchanged.
