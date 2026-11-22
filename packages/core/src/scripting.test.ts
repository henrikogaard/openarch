import { describe, expect, it } from 'vitest';
import { createSampleModel } from './validation';
import { runModelScript } from './scripting';

describe('model scripting sandbox', () => {
  it('runs a script that mutates and returns the model', () => {
    const model = createSampleModel();
    const result = runModelScript(
      model,
      `api.log('renaming', model.elements.length, 'elements');
       for (const el of model.elements) el.name = [{ lang: 'en', value: 'Renamed ' + (el.name[0]?.value ?? el.id) }];
       return model;`,
    );
    expect(result.logs[0]).toContain('renaming');
    expect(result.model.elements.every((e) => e.name[0].value.startsWith('Renamed '))).toBe(true);
    // input untouched
    expect(model.elements[0].name[0].value).not.toContain('Renamed');
  });

  it('accepts scripts that mutate the working copy without returning (jArchi semantics)', () => {
    const model = createSampleModel();
    const result = runModelScript(
      model,
      `model.elements.push({ id: 'added-by-script', type: 'BusinessActor', name: [{ lang: 'en', value: 'Scripted' }], documentation: [], properties: [] }); api.log('mutating');`,
    );
    expect(result.model.elements.some((element) => element.id === 'added-by-script')).toBe(true);
    expect(result.model.elements.length).toBe(model.elements.length + 1);
    expect(result.logs).toEqual(['mutating']);
    // The input model is untouched.
    expect(model.elements.some((element) => element.id === 'added-by-script')).toBe(false);
  });

  it('rejects scripts that do not return a model', () => {
    expect(() => runModelScript(createSampleModel(), 'return 42;')).toThrow(/return the model object/);
  });

  it('rejects skeleton models with a friendly message instead of a crash', () => {
    expect(() => runModelScript(createSampleModel(), 'return { id: "x", elements: [] };')).toThrow(
      /not a model/,
    );
  });

  it('rejects scripts whose result fails validation (no bypass)', () => {
    expect(() =>
      runModelScript(
        createSampleModel(),
        'model.relationships.push({ id: "bad", type: "Serving", source: "missing", target: "also-missing", name: [], documentation: [], properties: [] }); return model;',
      ),
    ).toThrow(/failed validation/);
  });

  it('rejects throwing scripts with the underlying message', () => {
    expect(() => runModelScript(createSampleModel(), 'throw new Error("boom")')).toThrow(/Script failed: boom/);
  });
});
