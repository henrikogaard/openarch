import { primaryText, validateModel, type Model, type ValidationIssue } from './index';

export interface ScriptResult {
  model: Model;
  logs: string[];
  issues: ValidationIssue[];
}

/**
 * Run a user script against a model, jArchi-style.
 *
 * The script is a function body with access to:
 *   - `model` — a working clone of the current model; mutate it freely
 *   - `api`   — { primaryText, validateModel, log(...) }
 * It may `return model` (or any model-shaped object). Like jArchi, mutating
 * without returning is enough — the mutated working copy is used.
 *
 * IMPORTANT: this is NOT a security sandbox. The script runs with the full
 * capabilities of the host (Node in the CLI, the browser in the web app) —
 * `new Function` prevent nothing beyond lexical scope. Only run scripts you
 * trust, exactly like running any other `.js` file. What IS guaranteed: the
 * result must be a model-shaped object and passes the same `validateModel`
 * gate as every other write (invariant 6: no bypass), so it cannot corrupt
 * the model, only change it validly.
 */
export function runModelScript(model: Model, code: string): ScriptResult {
  const logs: string[] = [];
  const api = {
    primaryText,
    validateModel,
    log: (...args: unknown[]) => {
      logs.push(args.map((value) => (typeof value === 'string' ? value : JSON.stringify(value))).join(' '));
    },
  };
  const working = structuredClone(model);
  let result: unknown;
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function('model', 'api', `'use strict';\n${code}`);
    result = fn(working, api);
  } catch (error) {
    throw new Error(`Script failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  // jArchi semantics: mutating the working copy without returning it is the
  // normal usage — fall back to the (possibly mutated) working copy.
  const next = (result as Model | undefined | null) ?? working;
  const shapeError = modelShapeProblem(next);
  if (shapeError) {
    throw new Error(shapeError);
  }
  const issues = validateModel(next);
  const errors = issues.filter((issue) => issue.severity === 'error');
  if (errors.length) {
    throw new Error(
      `Script result failed validation with ${errors.length} error(s): ${errors[0].message}`,
    );
  }
  return { model: next, logs, issues };
}

/** Friendly diagnostic for non-model return values, before validation crashes. */
function modelShapeProblem(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') {
    return `Script returned ${String(value)} — return the model object`;
  }
  const candidate = value as Partial<Model>;
  if (typeof candidate.id !== 'string' || !candidate.id.trim()) {
    return 'Script result has no valid id — return the model object';
  }
  if (!Array.isArray(candidate.elements) || !Array.isArray(candidate.relationships) || !Array.isArray(candidate.views)) {
    return 'Script result is not a model (elements/relationships/views must be arrays)';
  }
  return undefined;
}
