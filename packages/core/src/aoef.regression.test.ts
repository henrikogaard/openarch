import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseAoef, serializeAoef } from './aoef';
import type { Model, RawXml } from './types';
import { createSampleModel } from './validation';

const fixture = new URL('../../../examples/archisurance.xml', import.meta.url);
const archisuranceXml = readFileSync(fixture, 'utf-8');

describe('AOEF regressions', () => {
  it('parses properties with their definition names, not the wrapper object', () => {
    const model = parseAoef(archisuranceXml);
    expect(model.properties.map((property) => property.key)).toEqual([
      'Property1',
      'Property2',
    ]);
    expect(model.properties[0].value).toBe('Value of Property 1');
    expect(model.properties[0].definitionRef).toBe('propid-1');

    const element = model.elements.find((candidate) => candidate.properties.length > 0);
    expect(element?.properties[0].key).toBe('Property1');
    expect(element?.properties[0].value).toBe('Another Value of Property 1');
  });

  it('emits propertyDefinitionRef + value instead of key/value attributes', () => {
    const model = createSampleModel();
    model.elements[0].properties = [{ key: 'owner', value: 'alice' }];
    const xml = serializeAoef(model);

    expect(xml).not.toMatch(/<property\s+key=/);
    expect(xml).toMatch(/<property propertyDefinitionRef="propdef-\d+">/);
    expect(xml).toContain('<value>alice</value>');
    expect(xml).toContain('<propertyDefinition identifier="propdef-1" type="string">');
    expect(xml).toContain('<name>owner</name>');
  });

  it('declares the namespaces needed by xsi:type', () => {
    const xml = serializeAoef(createSampleModel());
    expect(xml).toContain('xmlns="http://www.opengroup.org/xsd/archimate/3.0/"');
    expect(xml).toContain('xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"');
    expect(xml).toContain('xsi:schemaLocation=');
  });

  it('honours deleting every node in a view', () => {
    const model = parseAoef(archisuranceXml);
    model.views[0].nodes = [];
    const reparsed = parseAoef(serializeAoef(model));
    expect(reparsed.views[0].nodes).toHaveLength(0);
  });

  it('honours deleting every view', () => {
    const model = parseAoef(archisuranceXml);
    model.views = [];
    const reparsed = parseAoef(serializeAoef(model));
    expect(reparsed.views).toHaveLength(0);
  });

  it('honours deleting every relationship', () => {
    const model = parseAoef(archisuranceXml);
    model.relationships = [];
    const reparsed = parseAoef(serializeAoef(model));
    expect(reparsed.relationships).toHaveLength(0);
  });

  it('does not nest property elements on repeated round-trips', () => {
    let xml = serializeAoef(parseAoef(archisuranceXml));
    for (let index = 0; index < 3; index += 1) {
      xml = serializeAoef(parseAoef(xml));
    }
    expect(xml).not.toMatch(/<property\s[^>]*>\s*<property\s/);
  });
});

describe('multi-language property values round-trip', () => {
  it('preserves every language variant of a property value on export', () => {
    const model: Model = {
      ...createSampleModel(),
      elements: [
        {
          id: 'e-multi',
          type: 'BusinessActor',
          name: [{ lang: 'en', value: 'Multi' }],
          documentation: [],
          properties: [
            {
              key: 'tier',
              value: 'gold',
              raw: {
                '@_propertyDefinitionRef': 'propdef-x',
                value: [
                  { '@_xml:lang': 'en', '#text': 'gold' },
                  { '@_xml:lang': 'no', '#text': 'gull' },
                ],
              },
            },
          ],
        },
      ],
    };
    const xml = serializeAoef(model);
    expect(xml).toContain('<value xml:lang="en">gold</value>');
    expect(xml).toContain('<value xml:lang="no">gull</value>');
    // And the round trip keeps both.
    const reparsed = parseAoef(xml);
    const property = reparsed.elements[0].properties[0];
    expect(property.value).toBe('gold');
    expect((property.raw?.value as RawXml[]).length).toBe(2);
  });

  it('exports app-created properties without an xml:lang (schema unchanged)', () => {
    const model = createSampleModel();
    const xml = serializeAoef(model);
    expect(xml).toContain('<value>2.4.1</value>');
    expect(xml).not.toContain('<value xml:lang="en">2.4.1</value>');
  });
});
