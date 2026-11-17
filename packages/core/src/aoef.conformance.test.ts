import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAoef, serializeAoef } from './aoef';
import { buildConfiguredView, defaultConfigFor } from './granulation';
import type { Model } from './types';
import { createSampleModel } from './validation';

const fixture = new URL('../../../examples/archisurance.xml', import.meta.url);
const schema = new URL('../../../test/fixtures/xsd/archimate3_Diagram.xsd', import.meta.url);
const archisuranceXml = readFileSync(fixture, 'utf-8');

/** xmllint is present on macOS and ubuntu-latest; skip elsewhere rather than fail. */
function hasXmllint(): boolean {
  try {
    execFileSync('xmllint', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const xmllintAvailable = hasXmllint();

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function validate(xml: string): ValidationResult {
  const directory = mkdtempSync(join(tmpdir(), 'openarch-xsd-'));
  const file = join(directory, 'model.xml');
  writeFileSync(file, xml, 'utf-8');
  try {
    execFileSync('xmllint', ['--noout', '--schema', schema.pathname, file], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { valid: true, errors: [] };
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString() ?? '';
    return {
      valid: false,
      errors: stderr
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    };
  }
}

/**
 * The Open Group example carries Dublin Core metadata. xmllint cannot resolve
 * the DC schema offline, so those strict-wildcard errors are environmental.
 * Everything else must be clean.
 */
function nonDublinCoreErrors(errors: string[]): string[] {
  return errors.filter(
    (line) =>
      !line.includes('purl.org/dc') &&
      !line.includes('No matching global element declaration') &&
      !line.endsWith('fails to validate'),
  );
}

describe.skipIf(!xmllintAvailable)('AOEF schema conformance', () => {
  it('validates a model created in the app', () => {
    const result = validate(serializeAoef(createSampleModel()));
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('validates a model with ad-hoc properties', () => {
    const model = createSampleModel();
    model.elements[0].properties = [
      { key: 'owner', value: 'alice' },
      { key: 'criticality', value: 'high' },
    ];
    const result = validate(serializeAoef(model));
    expect(result.errors).toEqual([]);
  });

  it('validates an empty model without emitting empty containers', () => {
    const model: Model = {
      id: 'empty-model',
      name: [{ lang: 'en', value: 'Empty' }],
      documentation: [],
      properties: [],
      propertyDefinitions: [],
      elements: [],
      relationships: [],
      views: [],
    };
    const xml = serializeAoef(model);
    expect(xml).not.toContain('<elements');
    expect(xml).not.toContain('<relationships');
    expect(validate(xml).errors).toEqual([]);
  });

  it('validates the ArchiSurance round-trip apart from Dublin Core imports', () => {
    const result = validate(serializeAoef(parseAoef(archisuranceXml)));
    expect(nonDublinCoreErrors(result.errors)).toEqual([]);
  });

  it('validates a generated viewpoint view with group label nodes', () => {
    const model = createSampleModel();
    const generated = buildConfiguredView(model, defaultConfigFor('deployment'));
    model.views.push(generated.view);
    const result = validate(serializeAoef(model));
    expect(result.errors).toEqual([]);
  });

  it('clamps negative coordinates to the non-negative schema type', () => {
    const model = createSampleModel();
    model.views[0].nodes[0].bounds = { x: -120, y: -40, w: 170, h: 64 };
    const xml = serializeAoef(model);
    expect(xml).toContain('x="0"');
    expect(xml).toContain('y="0"');
    expect(nonDublinCoreErrors(validate(xml).errors)).toEqual([]);
  });
});
