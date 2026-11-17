import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseAoef, serializeAoef } from './aoef';
import {
  allowedRelationships,
  getElementType,
  isAllowedRelationship,
} from './metamodel';
import type { Model } from './types';
import { createSampleModel, validateModel } from './validation';

const fixture = new URL('../../../examples/archisurance.xml', import.meta.url);
const archisuranceXml = readFileSync(fixture, 'utf-8');

/** Strip passthrough XML fragments so comparisons test understood data only. */
function comparable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(comparable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== 'raw')
        .map(([key, child]) => [key, comparable(child)]),
    );
  }
  return value;
}

describe('AOEF codec', () => {
  it('parses the Open Group ArchiSurance example', () => {
    const model = parseAoef(archisuranceXml);
    expect(model.name[0].value).toBe('Archisurance');
    expect(model.elements.length).toBeGreaterThan(100);
    expect(model.relationships.length).toBeGreaterThan(150);
    expect(model.views.length).toBeGreaterThan(10);
    expect(model.elements[0].id).toBeTruthy();
    expect(model.elements[0].type).toBeTruthy();
    expect(model.views[0].nodes[0].bounds.w).toBeGreaterThan(0);
  });

  it('round-trips a real model without losing understood data', () => {
    const original = parseAoef(archisuranceXml);
    const exported = serializeAoef(original);
    expect(exported).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(exported).toContain('http://www.opengroup.org/xsd/archimate/3.0/');

    const reparsed = parseAoef(exported);
    expect(comparable(reparsed)).toEqual(comparable(original));
  });

  it('preserves stable identifiers through export', () => {
    const model = parseAoef(archisuranceXml);
    const ids = new Set(model.elements.map((element) => element.id));
    const reparsed = parseAoef(serializeAoef(model));
    expect(reparsed.elements.every((element) => ids.has(element.id))).toBe(true);
    expect(reparsed.relationships.map((r) => r.id)).toEqual(
      model.relationships.map((r) => r.id),
    );
  });

  it('round-trips a model created in code', () => {
    const model: Model = createSampleModel();
    const reparsed = parseAoef(serializeAoef(model));
    expect(reparsed.elements).toHaveLength(model.elements.length);
    expect(reparsed.views[0].edges[0].source).toBe('n1');
    expect(reparsed.views[0].edges[0].target).toBe('n2');
  });
});

describe('metamodel', () => {
  it('knows the Phase 0 element subset', () => {
    expect(getElementType('BusinessActor')?.layer).toBe('business');
    expect(getElementType('ApplicationService')?.kind).toBe('behavior');
  });

  it('suggests valid relationships for the magic connector', () => {
    const suggestions = allowedRelationships('BusinessActor', 'BusinessProcess');
    expect(suggestions.map((s) => s.id)).toContain('Assignment');
    expect(suggestions.map((s) => s.id)).not.toContain('Access');
    expect(isAllowedRelationship('Access', 'ApplicationComponent', 'DataObject')).toBe(
      true,
    );
    expect(isAllowedRelationship('Access', 'BusinessActor', 'BusinessProcess')).toBe(
      false,
    );
  });
});

describe('validation', () => {
  it('finds no structural errors in the sample model', () => {
    expect(validateModel(createSampleModel()).filter((i) => i.severity === 'error')).toEqual(
      [],
    );
  });

  it('finds no structural errors in ArchiSurance', () => {
    const issues = validateModel(parseAoef(archisuranceXml));
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
});
