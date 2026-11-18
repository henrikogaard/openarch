import { primaryText, validateModel, type Model, type ValidationIssue } from './index';

export interface ScriptResult {
  model: Model;
  logs: string[];
  issues: ValidationIssue[];
}

/**
 * Run a user script against a model in a restricted sandbox (jArchi-style).
 *
 * The script is a function body with access to:
 *   - `model` — the current model (mutate or return a new one)
 *   - `api`   — { primaryText, validateModel, log(...) }
 * It must `return model` (or a replacement). No imports, no require, no
 * network — `new Function` gives it none of those. The result is validated
 * like any other write (invariant 6: no bypass).
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
  let result: unknown;
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function('model', 'api', `'use strict';\n${code}`);
    result = fn(structuredClone(model), api);
  } catch (error) {
    throw new Error(`Script failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const next = (result as Model | undefined) ?? model;
  if (!next || typeof next.id !== 'string' || !Array.isArray(next.elements)) {
    throw new Error('Script did not return a model (return the model object)');
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
