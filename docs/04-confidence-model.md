# 4. Confidence model

Confidence answers *"how much should this be believed?"* — never *"how much of
the device did we see?"* That second question is **coverage**, and the two are
reported separately at every level. Collapsing them into one number hides
exactly what a buyer needs to know.

## Four levels

```
 1. channel reliability   can this collection channel be believed?
 2. inference confidence  is this reasoning step sound?
 3. verdict confidence    is this conclusion about one subject sound?
 4. module / trust        how much of the picture did we actually see?
```

Two rules run through all four:

- **Weakest link.** A conclusion is never more reliable than the shakiest
  observation it rests on. Confidence only decreases as it moves up a chain.
- **Corroboration must be independent.** Two readings of the same analytics file
  are one observation, not two.

## Level 1 — channel reliability

Fixed per collection method; see
[03-evidence-model.md](03-evidence-model.md#provenance-is-not-optional). It is a
property of the channel, and it is the only place a constant enters the model
without being derived.

## Level 2 — inference confidence

```
inferenceConfidence = ruleConfidence × min(reliability of cited evidence)
```

`ruleConfidence` is the rule's own strength — how well the reasoning holds when
its inputs are perfect. The weakest cited channel damps it. This is applied
inside `ProvenanceEngine.derive()`, so a rule author cannot bypass it by
declaring a confidence directly.

`weight` is a separate field and never mixes with confidence. Weight is *how far
this claim should move a verdict*; confidence is *how much the claim should be
believed*. A very strong indicator read from a flaky channel is not the same
thing as a weak indicator read reliably, and one number cannot express both.

## Level 3 — verdict confidence

Two factors, multiplied.

### Corroboration (noisy-OR over independent sources)

Inferences are grouped by the **set of evidence sources** they rest on. Within a
group only the strongest counts; across groups:

```
combined = 1 − Π (1 − confidence_i)
```

So two independent signals at 0.6 give 0.84, while two 0.6 signals from the same
analytics file give 0.6. Without the grouping, one chatty source could
manufacture near-certainty by repeating itself — which is precisely the failure
mode of every diagnostics tool that counts checks instead of sources.

`independentSources` is carried on the result, because "three sources agree" is
a materially different report line from "one source said it three times".

### Agreement

```
agreement = winningMass / (winningMass + opposingMass)
```

where mass is `Σ weight × confidence` on each side. Conflicting evidence lowers
confidence even when the winning side has more mass: a contested conclusion is
genuinely less certain than an uncontested one. Inferences whose direction is
`REDUCES_DETERMINACY` are excluded from directional mass — they argue against
concluding at all, not for either side.

```
verdictConfidence = corroboration × agreement
```

An `INDETERMINATE` verdict reports **zero** confidence, by construction in
`conclude()`. There is nothing for confidence to be *in*: the engine did not
conclude. This is why abstention can never be laundered into a weak pass.

## Level 4 — module and trust confidence

### Coverage damping

```
moduleConfidence = verdictConfidence × (0.35 + 0.65 × coverage)
```

A module certain about one component out of ten has high verdict confidence and
low module confidence. The 0.35 floor keeps a well-evidenced but narrow
assessment from collapsing to zero, which would make it indistinguishable from
having looked at nothing at all.

### Weight damping

Pillars we are less sure of should influence the trust score less:

```
effectiveWeight ∝ baseWeight × (0.4 + 0.6 × confidence)
```

The 0.4 floor stops a pillar from dropping out entirely. Without it, a device
whose parts could barely be assessed would quietly become a
battery-and-software score wearing a trust badge.

### Aggregate confidence

```
confidence = Σ (pillar abstained ? 0 : pillarConfidence × baseWeight) / Σ baseWeight
```

Note the denominator: **all** pillar weight, not just the pillars that scored.
An abstaining module contributes zero confidence at its full base weight.

Measuring confidence only across scoring pillars was the subtler and more
dangerous option. A device where three of five modules abstained would still
report high confidence on the strength of the two that answered — and the
`INSUFFICIENT_EVIDENCE` threshold would never fire when it was most needed. A
fixture caught this: a sparse legacy iPhone 8 reported 74% confidence and
`TRUSTED_WITH_NOTES` with three of five modules abstaining. Under the current
rule it reports 30% and issues no verdict.

## The reporting threshold

```
MINIMUM_REPORTABLE_CONFIDENCE = 0.45
```

Below it, the trust verdict is `INSUFFICIENT_EVIDENCE` **whatever the score
was**. No number is printed on the report or the public verification page,
because there is nothing a score could honestly summarise.

This is the mechanical form of the rule that low confidence downgrades trust —
it is not a deduction that a good battery can buy back.

## Bands

| Band | Range | Shown as |
|---|---|---|
| `HIGH` | ≥ 0.80 | High confidence |
| `MODERATE` | ≥ 0.60 | Moderate confidence |
| `LOW` | ≥ 0.45 | Low confidence |
| `INSUFFICIENT` | < 0.45 | No verdict issued |

Bands exist so a report never prints a bare decimal at a non-technical reader.
The decimal is retained in the API and the evidence drawer for anyone who wants
to recompute it.

## Worked example

An iPhone 14 Pro whose display is listed in Parts and Service History:

```
evidence   DISPLAY ServiceHistoryLabel = "Genuine Apple Part"
           source TECHNICIAN, method TECHNICIAN_INPUT, reliability 0.70

inference  service.listed-in-service-history
           ruleConfidence 0.90 × weakest link 0.70          = 0.63
           weight 0.90, direction SUPPORTS_NEGATIVE

verdict    REPLACED_LIKELY
           corroboration 0.63 (one source group)
           agreement     1.00 (nothing opposing)
           confidence    0.63  → MODERATE
```

The same statement arriving from an OEM adapter at reliability 0.99 gives
`0.90 × 0.99 = 0.89`, and if both are present they are two independent source
groups: `1 − (1 − 0.63)(1 − 0.89) = 0.96`. No rule changes; the confidence rises
because the corroboration is real.
