import { createModel, primaryText, type Model } from '@openarch/core';
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

describe('applyIacDrift semantics (user work is never destroyed)', () => {
  it('keeps user-drawn relationships touching imported elements', () => {
    const model = modelWithIac(['aws_instance.web']);
    const userElement = {
      id: 'manual-1',
      type: 'BusinessActor',
      name: [{ lang: 'en', value: 'Customer' }],
      documentation: [],
      properties: [],
    };
    const userEdge = {
      id: 'user-rel',
      type: 'Association',
      source: model.elements[0].id,
      target: 'manual-1',
      name: [],
      documentation: [],
      properties: [],
    };
    const withUser: Model = { ...model, elements: [...model.elements, userElement], relationships: [userEdge] };
    const reimport = mapResources([resource('aws_instance.web', 'web', { size: 't3.large' })]);
    const drift = diffIacImport(withUser, reimport);
    const next = applyIacDrift(withUser, drift, reimport.relationships);
    // The user edge survives the drift apply even though an endpoint is iac.
    expect(next.relationships.some((r) => r.id === 'user-rel')).toBe(true);
    expect(next.elements.some((e) => e.id === 'manual-1')).toBe(true);
  });

  it("ignored 'added' resources leave no dangling relationships", () => {
    const model = modelWithIac(['aws_instance.web']);
    const reimport = mapResources([
      resource('aws_instance.web'),
      resource('aws_instance.api'), // would be added…
    ]);
    const drift = diffIacImport(model, reimport);
    // …but the user ignores the addition (UI filters it out).
    const active = { added: [], removed: drift.removed, changed: drift.changed };
    const next = applyIacDrift(model, active, reimport.relationships);
    // The incoming edge to the ignored element must not dangle.
    expect(next.elements.some((e) => iacAddressOf(e) === 'aws_instance.api')).toBe(false);
    for (const relationship of next.relationships) {
      expect(
        next.elements.some((e) => e.id === relationship.source) &&
          next.elements.some((e) => e.id === relationship.target),
      ).toBe(true);
    }
  });

  it("changed resources keep the user's name and domain", () => {
    const model = modelWithIac(['aws_instance.web']);
    // User customises the imported node.
    model.elements = model.elements.map((e) => ({
      ...e,
      name: [{ lang: 'en', value: 'My nice name' }],
      domain: 'domain-custom',
    }));
    const reimport = mapResources([resource('aws_instance.web', 'web', { size: 't3.large' })]);
    const drift = diffIacImport(model, reimport);
    const next = applyIacDrift(model, drift, reimport.relationships);
    const web = next.elements.find((e) => iacAddressOf(e) === 'aws_instance.web')!;
    expect(primaryText(web.name)).toBe('My nice name');
    expect(web.domain).toBe('domain-custom');
    // …while the importer's metadata was refreshed:
    expect(web.properties.some((p) => p.key === 'iacAttributes')).toBe(true);
  });
});

describe('terraform secret redaction', () => {
  it('never persists secret-looking attribute values', async () => {
    const { REDACTED_VALUE } = await import('./utils');
    const { flattenScalarAttributes } = await import('./utils');
    const flattened = flattenScalarAttributes({
      password: 'hunter2',
      db_master_secret: 'topsecret',
      api_key: 'AKIA123',
      private_key: '-----BEGIN',
      username: 'admin',
    });
    expect(flattened.password).toBe(REDACTED_VALUE);
    expect(flattened.db_master_secret).toBe(REDACTED_VALUE);
    expect(flattened.api_key).toBe(REDACTED_VALUE);
    expect(flattened.private_key).toBe(REDACTED_VALUE);
    expect(flattened.username).toBe('admin'); // not a secret-looking name
  });
});
