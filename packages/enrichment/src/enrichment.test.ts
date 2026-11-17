import { createSampleModel, getElementType } from '@openarch/core';
import { describe, expect, it } from 'vitest';
import { parseCsvResources } from './csv';
import { filesToResources } from './files';
import { proposeElements, proposalsToElements } from './propose';

describe('parseCsvResources', () => {
  it('parses quoted fields containing commas and escaped quotes', () => {
    const csv = [
      'id,name,description',
      '1,Billing Service,"Handles invoices, refunds and ""credits"""',
      '2,Customer,"Says ""hello, world"""',
    ].join('\r\n');
    const resources = parseCsvResources(csv);
    expect(resources).toHaveLength(2);
    expect(resources[0].key).toBe('1');
    expect(resources[0].fields.name).toBe('Billing Service');
    expect(resources[0].fields.description).toBe('Handles invoices, refunds and "credits"');
    expect(resources[1].fields.description).toBe('Says "hello, world"');
  });

  it('skips empty rows and defaults the key to row-N', () => {
    const resources = parseCsvResources('value,description\n1,foo\n\n2,bar\n');
    expect(resources.map((resource) => resource.key)).toEqual(['row-1', 'row-2']);
  });
});

describe('filesToResources', () => {
  it('produces a resource with path, name and ext fields', () => {
    const [resource] = filesToResources([{ path: 'src/service/orders.ts', content: 'export {}' }]);
    expect(resource.key).toBe('src/service/orders.ts');
    expect(resource.fields.name).toBe('orders.ts');
    expect(resource.fields.ext).toBe('ts');
    expect(resource.fields.content).toBe('export {}');
  });
});

describe('proposeElements', () => {
  it('infers ApplicationComponent for a .ts file and DataObject for a .sql file', () => {
    const model = createSampleModel();
    const resources = filesToResources([
      { path: 'src/api/OrdersService.ts', content: 'export class OrdersService {}' },
      { path: 'db/schema.sql', content: 'CREATE TABLE orders (id int);' },
    ]);
    const proposals = proposeElements(model, resources);
    expect(proposals.find((p) => p.name === 'OrdersService.ts')?.type).toBe('ApplicationComponent');
    expect(proposals.find((p) => p.name === 'schema.sql')?.type).toBe('DataObject');
    expect(proposals.every((p) => p.confidence >= 0.4 && p.confidence <= 0.95)).toBe(true);
  });

  it('is idempotent against a model that already contains the proposed elements', () => {
    const model = createSampleModel();
    const resources = filesToResources([{ path: 'src/api/OrdersService.ts', content: 'x' }]);
    const first = proposeElements(model, resources);
    expect(first).toHaveLength(1);
    model.elements.push(...proposalsToElements(first));
    expect(proposeElements(model, resources)).toHaveLength(0);
  });
});

describe('proposalsToElements', () => {
  it('creates valid elements with a source property', () => {
    const model = createSampleModel();
    const proposals = proposeElements(
      model,
      filesToResources([{ path: 'infra/cluster.yaml', content: 'kind: Cluster' }]),
    );
    const [element] = proposalsToElements(proposals);
    expect(element.id.startsWith('enriched-')).toBe(true);
    expect(getElementType(element.type)).toBeDefined();
    expect(element.name[0]?.value).toBe(proposals[0].name);
    expect(element.properties.find((property) => property.key === 'source')?.value).toBe(
      proposals[0].source,
    );
  });
});
