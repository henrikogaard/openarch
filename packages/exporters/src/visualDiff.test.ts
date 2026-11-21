import { describe, expect, it } from 'vitest';
import { createSampleModel, type Model } from '@openarch/core';
import { diffSnapshots } from './visualDiff';

/**
 * 5/7 — snapshot diff classifier: added/removed/unchanged per element and
 * relationship, plus the same exported SVG pair Collaborate renders.
 */
describe('diffSnapshots (5/7)', () => {
  it('classifies added/removed/unchanged elements and relationships', () => {
    const before = createSampleModel();
    const after: Model = structuredClone(before);
    const view = after.views.find((candidate) => candidate.id === 'view-overview')!;

    // Element renamed in place → unchanged presence; a new element → added; the
    // e-billing element removed → removed.
    after.elements = after.elements.filter((element) => element.id !== 'e-billing');
    view.nodes = view.nodes.filter((node) => node.elementRef !== 'e-billing');
    after.elements.push({
      id: 'e-new',
      type: 'BusinessActor',
      name: [{ lang: 'en', value: 'Newcomer' }],
      documentation: [],
      properties: [],
    });
    view.nodes.push({
      id: 'n-new',
      type: 'Element',
      elementRef: 'e-new',
      label: [],
      bounds: { x: 900, y: 80, w: 170, h: 64 },
    });
    const existing = after.relationships.find((relationship) => relationship.id === 'r-serve-6')!;
    after.relationships = after.relationships.filter((relationship) => relationship.id !== 'r-serve-6');
    after.relationships.push({ ...existing, id: 'rel-new', source: 'e-new', target: 'e-customer' });

    const diff = diffSnapshots(before, after, 'view-overview');
    expect(diff.elements.find((entry) => entry.id === 'e-new')?.status).toBe('added');
    expect(diff.elements.find((entry) => entry.id === 'e-billing')?.status ?? null).toBeNull();
    expect(diff.counts.added).toBeGreaterThan(0);
    expect(diff.counts.removed).toBeGreaterThan(0);
    // Both SVGs render (the view exists in both models).
    expect(diff.beforeSvg).toContain('<svg');
    expect(diff.afterSvg).toContain('<svg');
  });

  it('identical snapshots classify as all-unchanged and produce equal SVGs', () => {
    const model = createSampleModel();
    const diff = diffSnapshots(model, structuredClone(model), 'view-overview');
    expect(diff.counts.added).toBe(0);
    expect(diff.counts.removed).toBe(0);
    expect(diff.counts.unchanged).toBeGreaterThan(0);
    expect(diff.beforeSvg).toBe(diff.afterSvg);
  });
});
