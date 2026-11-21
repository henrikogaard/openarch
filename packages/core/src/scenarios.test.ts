import { createSampleModel, primaryText } from '@openarch/core';
import { describe, expect, it } from 'vitest';
import { migrationTimeline, requirementCoverage, scenarioCompare } from './scenarios';

function withRequirements() {
  const model = createSampleModel();
  model.elements.push(
    { id: 'req-1', type: 'Requirement', name: [{ lang: 'en', value: 'Multi-language UI' }], documentation: [], properties: [] },
    { id: 'req-2', type: 'Constraint', name: [{ lang: 'en', value: 'GDPR data residency' }], documentation: [], properties: [] },
  );
  model.relationships.push(
    { id: 'rr-1', type: 'Realization', source: 'e-portal', target: 'req-1', name: [], documentation: [], properties: [] },
  );
  return model;
}

describe('requirement coverage', () => {
  it('maps requirements to the elements realizing them', () => {
    const coverage = requirementCoverage(withRequirements());
    expect(coverage.length).toBe(2);
    const multiLanguage = coverage.find((entry) => entry.requirement.id === 'req-1')!;
    expect(multiLanguage.realizingElements.map((element) => element.id)).toEqual(['e-portal']);
    const gdpr = coverage.find((entry) => entry.requirement.id === 'req-2')!;
    expect(gdpr.realizingElements.length).toBe(0); // uncovered
  });
});

describe('migration timeline', () => {
  it('collects Plateau/WorkPackage/Deliverable milestones ordered by date', () => {
    const model = createSampleModel();
    model.elements.push(
      {
        id: 'ms-2', type: 'Plateau', name: [{ lang: 'en', value: 'Target 2027' }], documentation: [],
        properties: [{ key: 'date', value: '2027-06-01' }],
      },
      {
        id: 'ms-1', type: 'WorkPackage', name: [{ lang: 'en', value: 'Wave 1' }], documentation: [],
        properties: [{ key: 'startDate', value: '2026-12-01' }],
      },
    );
    const timeline = migrationTimeline(model);
    expect(timeline.map((milestone) => milestone.id).slice(0, 2)).toEqual(['ms-1', 'ms-2']);
    expect(timeline[0].kind).toBe('workpackage');
    expect(timeline[0].date).toBe('2026-12-01');
  });
});

describe('scenario compare', () => {
  it('scores identical models 100 and diverging models by overlap', () => {
    const current = createSampleModel();
    const same = createSampleModel();
    expect(scenarioCompare(current, same, current.relationships, same.relationships).score).toBe(1);
    const future = createSampleModel();
    future.elements = future.elements.map((element) =>
      element.id === 'e-portal'
        ? { ...element, name: [{ lang: 'en', value: primaryText(element.name) + ' v2' }] }
        : element,
    );
    future.elements.push({
      id: 'e-new', type: 'ApplicationComponent', name: [{ lang: 'en', value: 'New analytics' }], documentation: [], properties: [],
    });
    const diff = scenarioCompare(current, future, current.relationships, future.relationships);
    expect(diff.changedElementIds).toContain('e-portal');
    expect(diff.addedElementIds).toContain('e-new');
    expect(diff.score).toBeLessThan(1);
    expect(diff.score).toBeGreaterThan(0);
  });
});
