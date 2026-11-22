import { describe, expect, it } from 'vitest';
import { domainStats, filterModelByDomain, serializeAoef, validateModel } from './index';
import { createModel, type ArchiElement, type Model, type Relationship, type View } from './types';

/**
 * Performance smoke test: the core read/validate/export paths must stay fast
 * at 2,000+ elements. Generous bounds — this catches accidental blowups
 * (quadratic scans, repeated serialization), not normal variance.
 */
function bigModel(elements: number): Model {
  const els: ArchiElement[] = [];
  const rels: Relationship[] = [];
  for (let i = 0; i < elements; i += 1) {
    els.push({
      id: `e-${i}`,
      type: i % 3 === 0 ? 'ApplicationComponent' : i % 3 === 1 ? 'Node' : 'DataObject',
      name: [{ lang: 'en', value: `Element ${i}` }],
      documentation: [],
      properties: [{ key: 'index', value: String(i) }],
      domain: `domain-${i % 10}`,
      environment: i % 2 === 0 ? 'prod' : 'dev',
    });
    if (i > 0) {
      rels.push({
        id: `r-${i}`,
        type: 'Serving',
        source: `e-${i - 1}`,
        target: `e-${i}`,
        name: [],
        documentation: [],
        properties: [],
      });
    }
  }
  const view: View = {
    id: 'view-big',
    type: 'Diagram',
    name: [{ lang: 'en', value: 'Big' }],
    nodes: els.map((element, i) => ({
      id: `n-${i}`,
      type: 'Element',
      elementRef: element.id,
      label: [],
      bounds: { x: (i % 50) * 200, y: Math.floor(i / 50) * 100, w: 170, h: 64 },
    })),
    edges: rels.map((relationship, i) => ({
      id: `ed-${i}`,
      type: 'Relationship',
      relationshipRef: relationship.id,
      source: `n-${i}`,
      target: `n-${i + 1}`,
      bendpoints: [],
    })),
  };
  return createModel({
    id: 'big',
    name: [{ lang: 'en', value: 'Big model' }],
    elements: els,
    relationships: rels,
    views: [view],
    domains: Array.from({ length: 10 }, (_, i) => ({ id: `domain-${i}`, name: `Domain ${i}` })),
  });
}

describe('performance at 2,000 elements', () => {
  it('validates, filters, analyses and exports a 2k-element model quickly', () => {
    const model = bigModel(2000);
    expect(model.elements.length).toBe(2000);

    let start = performance.now();
    const issues = validateModel(model);
    const validateMs = performance.now() - start;
    expect(issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(validateMs).toBeLessThan(2000);

    start = performance.now();
    const scoped = filterModelByDomain(model, 'domain-3');
    expect(scoped.elements.length).toBe(200);
    expect(performance.now() - start).toBeLessThan(500);

    start = performance.now();
    expect(domainStats(model).length).toBe(10);
    expect(performance.now() - start).toBeLessThan(500);

    start = performance.now();
    const xml = serializeAoef(model);
    const serializeMs = performance.now() - start;
    expect(xml).toContain('Element 1999');
    expect(serializeMs).toBeLessThan(3000);
  });
});
