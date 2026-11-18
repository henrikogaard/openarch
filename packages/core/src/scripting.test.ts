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

  it('rejects scripts that do not return a model', () => {
    expect(() => runModelScript(createSampleModel(), 'return 42;')).toThrow(/did not return a model/);
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
