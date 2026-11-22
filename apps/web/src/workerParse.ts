/**
 * 6/7 — Performance hardening for the web tier.
 *
 * `parseAoefAsync` and `parseNativeAsync` move model parsing off the UI
 * thread into a Module Worker that imports the SAME codec functions the app
 * uses (no drift). Falls back to a synchronous parse when Workers are
 * unavailable or construction fails — identical output either way.
 */
export interface WorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  addEventListener(type: string, listener: (event: never) => void): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
}

export type WorkerFactory = (source: string) => WorkerLike;

/** Build the Worker inline (module workers import from the app bundle). */
const WORKER_SOURCE = `
import { parseAoef } from '@openarch/core';
import { parseNativeModel } from '@openarch/repository';
self.addEventListener('message', (event) => {
  const { kind, text } = event.data;
  try {
    const model = kind === 'aoef' ? parseAoef(text) : parseNativeModel(text);
    self.postMessage({ ok: true, model });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});
`;

let workerFactory: WorkerFactory | null = null;

/** Test hook: inject a fake Worker factory. */
export function setModelParseWorkerFactory(factory: WorkerFactory | null): void {
  workerFactory = factory;
}

function createWorker(): WorkerLike | null {
  if (workerFactory) return workerFactory(WORKER_SOURCE);
  if (typeof Worker === 'undefined') return null;
  try {
    // Module worker: bundlers resolve the imports and code-split.
    return new Worker(`data:text/javascript,${encodeURIComponent(WORKER_SOURCE)}`, {
      type: 'module',
    }) as never;
  } catch {
    return null;
  }
}

async function parseInWorker(
  kind: 'aoef' | 'native',
  text: string,
  fallback: (text: string) => never,
): Promise<never> {
  const worker = createWorker();
  if (!worker) return fallback(text);
  return new Promise<never>((resolve, reject) => {
    const sched = typeof window !== 'undefined' ? window.setTimeout.bind(window) : setTimeout;
    const timeout = sched(() => {
      worker.terminate();
      try {
        resolve(fallback(text));
      } catch (error) {
        reject(error);
      }
    }, 8000);
    worker.onmessage = (event: { data: unknown }) => {
      clearTimeout(timeout);
      worker.terminate();
      const payload = event.data as { ok: boolean; model?: never; error?: string };
      if (payload.ok && payload.model) resolve(payload.model);
      else reject(new Error(payload.error ?? 'Worker parse failed'));
    };
    worker.onerror = (event: { message?: string }) => {
      clearTimeout(timeout);
      worker.terminate();
      try {
        resolve(fallback(text));
      } catch {
        reject(new Error(event.message ?? 'Worker crashed during parse'));
      }
    };
    worker.postMessage({ kind, text });
  });
}

export async function parseAoefAsync(text: string): Promise<never> {
  const { parseAoef } = await import('@openarch/core');
  return parseInWorker('aoef', text, (value) => parseAoef(value) as never);
}

export async function parseNativeAsync(text: string): Promise<never> {
  const { parseNativeModel } = await import('@openarch/repository');
  return parseInWorker('native', text, (value) => parseNativeModel(value) as never);
}
