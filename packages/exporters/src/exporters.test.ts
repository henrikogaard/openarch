import type { ArchiElement, Model, Relationship, View } from '@openarch/core';
import { describe, expect, it } from 'vitest';
import { exportElementsCsv, exportRelationshipsCsv } from './csv';
import { exportMermaid } from './mermaid';
import { exportViewSvg } from './svg';

const elements: ArchiElement[] = [
  {
    id: 'e1',
    type: 'BusinessActor',
    name: [{ lang: 'en', value: 'Customer, External' }],
    documentation: [],
    properties: [],
  },
  {
    id: 'e2',
    type: 'BusinessProcess',
    name: [{ lang: 'en', value: 'Checkout' }],
    documentation: [],
    properties: [],
  },
];

const relationships: Relationship[] = [
  {
    id: 'r1',
    type: 'Assignment',
    source: 'e1',
    target: 'e2',
    name: [{ lang: 'en', value: 'Performs' }],
    documentation: [],
    properties: [],
  },
];

const view: View = {
  id: 'v1',
  type: 'Diagram',
  name: [{ lang: 'en', value: 'Overview' }],
  nodes: [
    {
      id: 'n1',
      type: 'Element',
      elementRef: 'e1',
      label: [],
      bounds: { x: 10, y: 20, w: 120, h: 60 },
    },
    {
      id: 'n2',
      type: 'Element',
      elementRef: 'e2',
      label: [],
      bounds: { x: 300, y: 20, w: 120, h: 60 },
    },
  ],
  edges: [
    {
      id: 'ed1',
      type: 'Relationship',
      relationshipRef: 'r1',
      source: 'n1',
      target: 'n2',
      bendpoints: [],
    },
  ],
};

const model: Model = {
  id: 'm1',
  name: [{ lang: 'en', value: 'Test model' }],
  documentation: [],
  properties: [],
  propertyDefinitions: [],
  elements,
  relationships,
  views: [view],
};

describe('SVG export', () => {
  it('produces a standalone SVG containing element names', () => {
    const svg = exportViewSvg(model, 'v1');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('Customer, External');
    expect(svg).toContain('Checkout');
  });
});

describe('CSV export', () => {
  it('writes the element header and quotes names containing a comma', () => {
    const csv = exportElementsCsv(model);
    expect(csv.split('\n')[0]).toBe('id,type,name,layer,documentation');
    expect(csv).toContain('"Customer, External"');
  });

  it('writes the relationship header and rows', () => {
    const csv = exportRelationshipsCsv(model);
    expect(csv.split('\n')[0]).toBe('id,type,source,target,name');
    expect(csv).toContain('r1,Assignment,e1,e2,Performs');
  });
});

describe('Mermaid export', () => {
  it('emits a flowchart with the relationship label', () => {
    const mermaid = exportMermaid(model, 'v1');
    expect(mermaid).toContain('flowchart LR');
    expect(mermaid).toContain('Assignment');
  });
});
