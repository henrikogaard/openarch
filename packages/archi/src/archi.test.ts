import type { Model } from '@openarch/core';
import { createModel, primaryText } from '@openarch/core';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { exportArchi } from './export';
import { importArchi } from './import';

function nativeXml(body: string, name = 'Fixture', id = 'm-fixture'): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<archimate:model xmlns:archimate="http://www.archimatetool.com/archimate" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" name="${name}" id="${id}">
${body}
</archimate:model>`;
}

function archive(xml: string, path = 'model.xml'): Uint8Array {
  return zipSync({ [path]: strToU8(xml) });
}

const roundTripModel: Model = createModel({
  id: 'model-archi',
  name: [{ lang: 'en', value: 'Archi round trip' }],
  documentation: [{ lang: 'en', value: 'Round-trip fixture' }],
  elements: [
    {
      id: 'e-actor',
      type: 'BusinessActor',
      name: [{ value: 'Customer' }],
      documentation: [],
      properties: [],
    },
    {
      id: 'e-process',
      type: 'BusinessProcess',
      name: [{ value: 'Order' }],
      documentation: [{ value: 'Handles orders' }],
      properties: [{ key: 'owner', value: 'Sales' }],
    },
    {
      id: 'e-app',
      type: 'ApplicationComponent',
      name: [{ value: 'CRM' }],
      documentation: [],
      properties: [],
    },
  ],
  relationships: [
    {
      id: 'r-assign',
      type: 'Assignment',
      source: 'e-actor',
      target: 'e-process',
      name: [{ value: 'Performs' }],
      documentation: [],
      properties: [],
    },
    {
      id: 'r-serve',
      type: 'Serving',
      source: 'e-process',
      target: 'e-app',
      name: [],
      documentation: [],
      properties: [],
    },
  ],
  views: [
    {
      id: 'v-main',
      type: 'Diagram',
      name: [{ value: 'Main' }],
      nodes: [
        {
          id: 'n-actor',
          type: 'Element',
          elementRef: 'e-actor',
          label: [],
          bounds: { x: 10, y: 20, w: 120, h: 60 },
        },
        {
          id: 'n-process',
          type: 'Element',
          elementRef: 'e-process',
          label: [],
          bounds: { x: 220, y: 20, w: 120, h: 60 },
        },
      ],
      edges: [
        {
          id: 'c-1',
          type: 'Relationship',
          relationshipRef: 'r-assign',
          source: 'n-actor',
          target: 'n-process',
          bendpoints: [],
        },
      ],
    },
  ],
});

describe('exportArchi', () => {
  it('writes a ZIP archive containing native model.xml', () => {
    const bytes = exportArchi(roundTripModel);

    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);

    const files = unzipSync(bytes);
    expect(Object.keys(files)).toContain('model.xml');

    const xml = strFromU8(files['model.xml']);
    expect(xml).toContain('xmlns:archimate="http://www.archimatetool.com/archimate"');
    expect(xml).toContain('type="AssignmentRelationship"');
    expect(xml).toContain('type="ServingRelationship"');
    expect(xml).toContain('xsi:type="archimate:DiagramModelArchimateObject"');
  });
});

describe('importArchi', () => {
  it('round-trips elements, relationships, and view geometry', () => {
    const { model, warnings } = importArchi(exportArchi(roundTripModel));

    expect(warnings).toEqual([]);
    expect(model.id).toBe('model-archi');
    expect(primaryText(model.name)).toBe('Archi round trip');
    expect(primaryText(model.documentation)).toBe('Round-trip fixture');

    expect(model.elements.find((element) => element.id === 'e-actor')).toMatchObject({
      type: 'BusinessActor',
      name: [{ value: 'Customer' }],
      domain: 'domain-business',
    });
    expect(model.elements.find((element) => element.id === 'e-process')).toMatchObject({
      type: 'BusinessProcess',
      name: [{ value: 'Order' }],
      documentation: [{ value: 'Handles orders' }],
      properties: [{ key: 'owner', value: 'Sales' }],
      domain: 'domain-business',
    });
    expect(model.elements.find((element) => element.id === 'e-app')).toMatchObject({
      type: 'ApplicationComponent',
      name: [{ value: 'CRM' }],
      domain: 'domain-application',
    });

    expect(model.relationships.find((relationship) => relationship.id === 'r-assign')).toMatchObject({
      type: 'Assignment',
      source: 'e-actor',
      target: 'e-process',
      name: [{ value: 'Performs' }],
    });
    expect(model.relationships.find((relationship) => relationship.id === 'r-serve')).toMatchObject({
      type: 'Serving',
      source: 'e-process',
      target: 'e-app',
    });

    const view = model.views[0];
    expect(view.id).toBe('v-main');
    expect(primaryText(view.name)).toBe('Main');
    expect(view.nodes).toHaveLength(2);
    expect(view.nodes.find((node) => node.id === 'n-actor')).toMatchObject({
      type: 'Element',
      elementRef: 'e-actor',
      bounds: { x: 10, y: 20, w: 120, h: 60 },
    });
    expect(view.nodes.find((node) => node.id === 'n-process')).toMatchObject({
      type: 'Element',
      elementRef: 'e-process',
      bounds: { x: 220, y: 20, w: 120, h: 60 },
    });
    expect(view.edges[0]).toMatchObject({
      relationshipRef: 'r-assign',
      source: 'n-actor',
      target: 'n-process',
    });
  });

  it('maps a hand-written native model, including relationship suffixes', () => {
    const xml = nativeXml(`
  <folder name="Business" id="f-business" type="business">
    <element id="e-actor" name="Customer" type="BusinessActor">
      <documentation>External customer</documentation>
      <properties>
        <property key="owner" value="Sales"/>
      </properties>
    </element>
    <folder name="Nested" id="f-nested" type="business">
      <element id="e-process" name="Order" type="BusinessProcess"/>
    </folder>
  </folder>
  <folder name="Relations" id="f-relations" type="relations">
    <element id="r-serve" name="Serves" type="ServingRelationship" source="e-process" target="e-actor"/>
  </folder>
  <folder name="Views" id="f-views" type="diagrams">
    <view id="v-main" name="Main">
      <child xsi:type="archimate:DiagramModelArchimateObject" id="n-actor">
        <bounds x="10" y="20" width="120" height="60"/>
        <archimateElement xsi:type="archimate:BusinessActor" href="e-actor"/>
      </child>
      <child xsi:type="archimate:DiagramModelGroup" id="n-group" name="Group">
        <bounds x="0" y="0" width="400" height="300"/>
        <child xsi:type="archimate:DiagramModelArchimateObject" id="n-process">
          <bounds x="200" y="40" width="120" height="60"/>
          <archimateElement xsi:type="archimate:BusinessProcess" href="e-process"/>
        </child>
      </child>
      <connection xsi:type="archimate:DiagramModelArchimateConnection" id="c-1" source="n-process" target="n-actor">
        <archimateRelationship href="r-serve"/>
      </connection>
      <connection xsi:type="archimate:DiagramModelArchimateConnection" id="c-dangling" source="n-actor" target="n-missing">
        <archimateRelationship href="r-serve"/>
      </connection>
    </view>
  </folder>
`);

    const { model, warnings } = importArchi(archive(xml));

    expect(model.id).toBe('m-fixture');
    expect(primaryText(model.name)).toBe('Fixture');

    expect(model.elements.find((element) => element.id === 'e-actor')).toMatchObject({
      type: 'BusinessActor',
      name: [{ value: 'Customer' }],
      documentation: [{ value: 'External customer' }],
      properties: [{ key: 'owner', value: 'Sales' }],
      domain: 'domain-business',
    });
    expect(model.elements.find((element) => element.id === 'e-process')).toMatchObject({
      type: 'BusinessProcess',
      name: [{ value: 'Order' }],
      domain: 'domain-business',
    });

    expect(model.relationships).toHaveLength(1);
    expect(model.relationships[0]).toMatchObject({
      id: 'r-serve',
      type: 'Serving',
      source: 'e-process',
      target: 'e-actor',
    });

    const view = model.views[0];
    expect(view.nodes).toHaveLength(3);
    expect(view.nodes.find((node) => node.id === 'n-group')).toMatchObject({
      type: 'Label',
      label: [{ value: 'Group' }],
      bounds: { x: 0, y: 0, w: 400, h: 300 },
    });
    expect(view.nodes.find((node) => node.id === 'n-process')).toMatchObject({
      type: 'Element',
      elementRef: 'e-process',
      bounds: { x: 200, y: 40, w: 120, h: 60 },
    });
    expect(view.edges).toHaveLength(1);
    expect(view.edges[0]).toMatchObject({
      id: 'c-1',
      relationshipRef: 'r-serve',
      source: 'n-process',
      target: 'n-actor',
    });
    expect(warnings.some((warning) => warning.includes('c-dangling'))).toBe(true);
  });

  it('accepts model.xml inside a model/ directory', () => {
    const xml = nativeXml(`
  <folder name="Business" id="f-business" type="business">
    <element id="e-actor" name="Customer" type="BusinessActor"/>
  </folder>
`);

    const { model } = importArchi(archive(xml, 'model/model.xml'));
    expect(model.elements).toHaveLength(1);
    expect(model.elements[0].id).toBe('e-actor');
  });

  it('keeps unknown element types and reports a warning', () => {
    const xml = nativeXml(
      `
  <folder name="Other" id="f-other" type="other">
    <element id="e-mystery" name="Mystery" type="MysteryThing"/>
  </folder>
`,
      'Unknown model',
      'm-unknown',
    );

    const { model, warnings } = importArchi(archive(xml));

    expect(model.elements).toHaveLength(1);
    expect(model.elements[0]).toMatchObject({
      id: 'e-mystery',
      type: 'MysteryThing',
      name: [{ value: 'Mystery' }],
    });
    expect(warnings.some((warning) => warning.includes('MysteryThing'))).toBe(true);
  });

  it('throws a clear error when model.xml is missing', () => {
    const bytes = zipSync({ 'readme.txt': strToU8('not an Archi model') });
    expect(() => importArchi(bytes)).toThrow(/model\.xml/);
  });

  it('throws a clear error for an invalid ZIP', () => {
    expect(() => importArchi(new Uint8Array([1, 2, 3, 4]))).toThrow(/Invalid Archi archive/);
  });
});

describe('Archi 5+ property definitions and archive guards', () => {
  function makeModelXml(properties: string, definitions = ''): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<archimate:model xmlns:archimate="http://www.archimatetool.com/archimate" name="A5" id="a5">
  <propertyDefinitions>${definitions}</propertyDefinitions>
  <folder name="Business" id="f1">
    <element xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="BusinessActor" id="e1" name="Vip">
      <properties>
        ${properties}
      </properties>
    </element>
  </folder>
</archimate:model>`;
  }

  function zipFor(modelXml: string): Uint8Array {
    return zipSync({ 'model.xml': strToU8(modelXml) });
  }

  it('imports Archi 5 propertyDefinitionRef properties (previously silently dropped)', () => {
    const xml = makeModelXml(
      `<property propertyDefinitionRef="pd-1"><value>gold</value></property>`,
      `<propertyDefinition id="pd-1" name="tier"><value>string</value></propertyDefinition>`,
    );
    const result = importArchi(zipFor(xml));
    const element = result.model.elements.find((e) => e.id === 'e1')!;
    expect(element.properties).toEqual([{ key: 'tier', value: 'gold' }]);
  });

  it('still imports legacy key/value properties unchanged', () => {
    const xml = makeModelXml(`<property key="owner" value="pk"/>`);
    const result = importArchi(zipFor(xml));
    expect(result.model.elements[0].properties).toEqual([{ key: 'owner', value: 'pk' }]);
  });

  it('rejects archives with too many entries', () => {
    const entries: Record<string, Uint8Array> = {};
    for (let i = 0; i < 2500; i += 1) entries[`junk-${i}.txt`] = strToU8('x');
    const bomb = zipSync(entries);
    expect(() => importArchi(bomb)).toThrow(/archive/i);
  });
});
