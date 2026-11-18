import { createModel, type Model } from '@openarch/core';
import { describe, expect, it } from 'vitest';
import { applyIacDrift, diffIacImport, iacAddressOf } from './drift';
import { mapResources, type IacResource } from './index';

function resource(address: string, name = address, attributes: Record<string, string> = {}): IacResource {
  return { address, kind: 'aws_instance', name, provider: 'aws', attributes, dependencies: [] };
}

function modelWithIac(addresses: string[]): Model {
  const imported = mapResources(addresses.map((address) => resource(address)));
  return createModel({ id: 'm', name: [{ lang: 'en', value: 'M' }], elements: imported.elements, relationships: imported.relationships, views: [] });
}

describe('IaC drift detection', () => {
  it('reports added, removed, and changed resources by iacAddress', () => {
    const model = modelWithIac(['aws_instance.web', 'aws_instance.db']);
    const reimport = mapResources([
      resource('aws_instance.web', 'web', { size: 't3.large' }), // changed attributes
      resource('aws_instance.api'), // added
      // db removed
    ]);
    const drift = diffIacImport(model, reimport);
    expect(drift.added.map((e) => iacAddressOf(e))).toEqual(['aws_instance.api']);
    expect(drift.removed.map((e) => iacAddressOf(e))).toEqual(['aws_instance.db']);
    expect(drift.changed.map((c) => iacAddressOf(c.incoming))).toEqual(['aws_instance.web']);
  });

  it('applyIacDrift upserts changed, deletes removed, and keeps non-iac content', () => {
    const model = modelWithIac(['aws_instance.web', 'aws_instance.db']);
    const manual = {
      id: 'manual-1',
      type: 'BusinessActor',
      name: [{ lang: 'en', value: 'Customer' }],
      documentation: [],
      properties: [],
    };
    const withManual: Model = { ...model, elements: [...model.elements, manual] };
    const reimport = mapResources([resource('aws_instance.web', 'web', { size: 't3.large' })]);
    const drift = diffIacImport(withManual, reimport);
    const next = applyIacDrift(withManual, drift, reimport.relationships);

    expect(next.elements.some((e) => e.id === 'manual-1')).toBe(true);
    expect(next.elements.some((e) => iacAddressOf(e) === 'aws_instance.db')).toBe(false);
    const web = next.elements.find((e) => iacAddressOf(e) === 'aws_instance.web')!;
    expect(web.properties.some((p) => p.key === 'iacKind')).toBe(true);
    expect(JSON.stringify(web.properties)).toContain('t3.large');
  });

  it('is a no-op when nothing changed', () => {
    const model = modelWithIac(['aws_instance.web']);
    const same = mapResources([resource('aws_instance.web')]);
    const drift = diffIacImport(model, same);
    expect(drift.added).toEqual([]);
    expect(drift.removed).toEqual([]);
    expect(drift.changed).toEqual([]);
  });
});
