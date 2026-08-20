# 7. Explainability

Mandatory, and implemented rather than promised. Every detected defect renders:

```
Detected Damage:  Deep scratch
Location:         Rear glass
Confidence:       93%
Evidence:         ev_22da2f1707e8fb23954bbe84 (img_back)
Impact:           Visible under any lighting; reduces resale grade.
```

## The confidence shown is calibrated, never the model score

This is the field most systems get wrong, and getting it wrong is how a product
tells a customer it is 97% sure of something it has never been measured on.

```ts
expect(explanation.evidence.modelScore).toBeCloseTo(0.96);  // the network's activation
expect(explanation.confidence).toBe(0.5);                    // what we have measured
```

The model score is retained on the evidence record for the audit trail and is
never presented as confidence. What the report prints is the **calibrated
reliability** for that class — measured precision on held-out devices.

Today those numbers differ sharply, because nothing has been measured. That is
the honest state and the report says so.

## Four levels of explanation, for four audiences

**The technician** needs to act. Findings ordered by what they actually cost the
score, each with the surface and a plain-language impact.

**The buyer** needs to trust the report. The verification page restates the
grade, the findings, the confidence, the coverage, and — with equal prominence —
what was not assessed.

**The disputing shop** needs to challenge a specific claim. Every explanation
carries its evidence id, which resolves to a record naming the image, the box,
the model version, the taxonomy version and the calibration id. Rejections are
equally traceable: the measured sharpness and the threshold it failed are both
stored, so *"your system rejected my photograph"* is answered with a number
rather than an opinion.

**The auditor** needs to verify the whole chain. Every inference cites evidence
ids; every verdict cites inference ids; the post-hoc provenance audit returns
empty on every path, asserted across all fixtures.

## Explanations are ordered by cost, not by confidence

```ts
expect(report.explanations[0]?.classId).toBe('CRACK_STRUCTURAL');
```

A confident detection of a light scratch is less important than a moderately
confident detection of a structural crack. Ordering by confidence would put the
easy findings first, which is the wrong order for everyone who reads it.

## What is *not* claimed to be explainable

The detector's internals. No saliency map, no attention visualisation, no
"the model looked here" overlay.

Those techniques are useful for debugging and misleading in a report: they
produce a plausible picture that a reader takes as a reason, when they are a
post-hoc rationalisation of an activation. DevDNA's explainability claim is
narrower and actually holds: **the model's outputs are evidence, its accuracy is
measured, and every conclusion cites the specific detection it rests on.**

Anything stronger would be the black box wearing a diagram.

## Bounding boxes on the report

The stored box is normalised to 0..1, so it survives any resize and can be
overlaid on a thumbnail at any resolution. The images themselves are never
returned by a customer-facing API — the report renders crops the issuing
organisation generated at inspection time.
