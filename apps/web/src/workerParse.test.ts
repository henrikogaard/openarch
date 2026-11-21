// @vitest-environment jsdom
import { createSampleModel, serializeAoef } from '@openarch/core';
import { serializeNativeModel } from '@openarch/repository';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { parseAoefAsync, parseNativeAsync, setModelParseWorkerFactory, type WorkerLike } from './workerParse';

function fakeWorkerFactory(ok: boolean, delayMs = 0): (source: string) => WorkerLike {
  return () => {
    const worker: WorkerLike & { _onmessage?: unknown } = {
      postMessage(data: unknown) {
        const payload = data as { kind: string; text: string };
        setTimeout(() => {
          let model: unknown;
          try {
            if (payload.kind === 'aoef') model = serializeAoef(createSampleModel());
            else model = serializeNativeModel(createSampleModel());
            (worker as { onmessage: ((event: { data: unknown }) => void) | null }).onmessage?.({
              data: { ok, model },
            });
          } catch (error) {
            (worker as { onmessage: ((event: { data: unknown }) => void) | null }).onmessage?.({
              data: { ok: false, error: (error as Error).message },
            });
          }
        }, delayMs);
        void payload;
      },
      terminate: vi.fn(),
      addEventListener: vi.fn(),
      onmessage: null,
      onerror: null,
    };
    return worker;
  };
}

afterEach(() => {
  setModelParseWorkerFactory(null);
});

describe('worker parse (6/7)', () => {
  it('parses AOEF via the Worker factory and returns the model', async () => {
    setModelParseWorkerFactory(fakeWorkerFactory(true) as never);
    const model = await parseAoefAsync(serializeAoef(createSampleModel()));
    expect(model).toBeTruthy();
  });

  it('parses native JSON via the same pipeline', async () => {
    setModelParseWorkerFactory(fakeWorkerFactory(true) as never);
    const model = await parseNativeAsync(serializeNativeModel(createSampleModel()));
    expect(model).toBeTruthy();
  });

  it('without a factory (no Worker), falls back to the same-thread parse', async () => {
    setModelParseWorkerFactory(null);
    const model = await parseAoefAsync(serializeAoef(createSampleModel()));
    expect(model).toBeTruthy();
  });
});
