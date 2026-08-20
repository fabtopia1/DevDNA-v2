import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  DEFECT_CLASSES,
  TAXONOMY_VERSION,
  SURFACE_SUBJECT,
  Surface,
} from '../src/taxonomy.js';
import { VIEW_SPECS } from '../src/capture/views.js';

/**
 * Export the taxonomy for the annotation platform and the training pipeline.
 *
 * The taxonomy is defined once, in TypeScript, and everything else is generated
 * from it. That is not a stylistic preference — a label map that drifts from
 * the scorer's class list is the defect that cannot be found by testing either
 * side, because both are internally consistent. The model happily learns class
 * 17 while the scorer prices class 17 as something else, and every number
 * downstream is quietly wrong.
 *
 * Run: pnpm --filter @devdna/physical export:taxonomy
 */

const out = resolve(process.argv[2] ?? 'dist/taxonomy.json');

const payload = {
  taxonomyVersion: TAXONOMY_VERSION,
  generatedAt: new Date().toISOString(),
  /** Ordinal index is the model's class id. Order is the array order — stable. */
  classes: DEFECT_CLASSES.map((entry, index) => ({
    index,
    id: entry.id,
    group: entry.group,
    label: entry.label,
    nature: entry.nature,
    surfaces: entry.surfaces,
    geometry: entry.geometry,
    severityWeight: entry.severityWeight,
    findingSeverity: entry.findingSeverity,
    impact: entry.impact,
    trustRelevant: entry.trustRelevant,
    annotationRule: entry.annotationRule,
    notToBeConfusedWith: entry.notToBeConfusedWith ?? null,
  })),
  surfaces: Object.values(Surface).map((surface) => ({
    id: surface,
    evidenceSubject: SURFACE_SUBJECT[surface],
  })),
  views: VIEW_SPECS.map((spec) => ({
    id: spec.view,
    label: spec.label,
    instruction: spec.instruction,
    surfaces: spec.surfaces,
    displayState: spec.displayState,
    required: spec.required,
    minLongEdgePx: spec.minLongEdgePx,
    minSharpness: spec.minSharpness,
    maxCaptures: spec.maxCaptures,
  })),
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
process.stdout.write(
  `taxonomy ${TAXONOMY_VERSION}: ${payload.classes.length} classes, ` +
    `${payload.views.length} views -> ${out}\n`,
);
