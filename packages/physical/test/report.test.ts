import { describe, expect, it } from 'vitest';
import { REQUIRED_VIEWS, CaptureView } from '../src/capture/views.js';
import { Surface } from '../src/taxonomy.js';
import { MockDetector, type ScriptedDefect } from '../src/detection/mock.js';
import { inspectPhysical } from '../src/inspection.js';
import { buildReportSection, renderReportSection } from '../src/report.js';
import { blurredImage, goodImage } from './images.js';
import type { CaptureInput } from '../src/validation/types.js';

const AT = '2026-08-19T10:00:00.000Z';

const captures = (broken: CaptureView[] = []): CaptureInput[] =>
  REQUIRED_VIEWS.map((view, i) => ({
    imageId: `img_${view.toLowerCase()}`,
    view,
    image: broken.includes(view) ? blurredImage(i) : goodImage(i),
    capturedAt: AT,
    sha256: 'a'.repeat(64),
  }));

const SCRATCH: ScriptedDefect = {
  imageId: 'img_bottom_edge',
  classId: 'SCRATCH_LIGHT',
  surface: Surface.FRAME,
  box: { x: 0.3, y: 0.5, width: 0.05, height: 0.01 },
  modelScore: 0.93,
};

describe('report integration', () => {
  it('renders the section a technician and a buyer both read', async () => {
    const report = await inspectPhysical({
      captures: captures(),
      detector: new MockDetector([SCRATCH]),
      capturedAt: AT,
    });
    const rendered = renderReportSection(report);

    expect(rendered).toContain('PhysicalDNA');
    expect(rendered).toContain('Overall Condition:');
    expect(rendered).toContain('PhysicalDNA Score:');
    expect(rendered).toContain('Inspection Confidence:');
    // Every finding carries its evidence block. This is the mandated format.
    expect(rendered).toContain('Detected Damage:  Light scratch');
    expect(rendered).toContain('Location:         Frame');
    expect(rendered).toMatch(/Evidence:\s+ev_/);
    expect(rendered).toContain('Impact:');
  });

  it('prints no score at all when the evidence is insufficient', async () => {
    const report = await inspectPhysical({
      captures: captures(REQUIRED_VIEWS),
      detector: new MockDetector(),
      capturedAt: AT,
    });
    const section = buildReportSection(report);
    expect(section.physicalDnaScore).toBeNull();
    expect(renderReportSection(report)).toContain('insufficient evidence');
  });

  it('always states what was not assessed', async () => {
    const report = await inspectPhysical({
      captures: captures([CaptureView.BACK]),
      detector: new MockDetector(),
      capturedAt: AT,
    });
    const rendered = renderReportSection(report);
    expect(rendered).toContain('Not assessed:');
    expect(rendered).toContain('No claim is made about these surfaces.');
  });

  it('discloses the caps that limited the grade', async () => {
    const report = await inspectPhysical({
      captures: captures(),
      detector: new MockDetector(),
      capturedAt: AT,
    });
    const rendered = renderReportSection(report);
    expect(rendered).toContain('Limits on this assessment:');
    expect(rendered).toMatch(/no measured precision or recall/);
  });
});
