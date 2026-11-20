import { createSampleModel } from '@openarch/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebDavDriftError, WebDavRepository } from './webdav';
import { serializeNativeModel } from './local';

afterEach(() => {
  vi.unstubAllGlobals();
});

interface MockResponse {
  ok: boolean;
  status: number;
  text: string;
}

function enqueue(responses: MockResponse[], capture: { body?: string } = {}): void {
  const queue = [...responses];
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'PUT') capture.body = String(init?.body ?? '');
    if (method === 'PROPFIND') method.toLowerCase();
    const next = queue.shift();
    if (!next) throw new Error(`unexpected ${method} ${url}`);
    return new Response(next.text, { status: next.status }) as never;
  }));
}

describe('WebDavRepository (4/7)', () => {
  it('lists workspaces through PROPFIND + per-file GET', async () => {
    const model = createSampleModel();
    const listing = `
      <D:multistatus xmlns:D="DAV:">
        <D:response>
          <D:href>/openarch/models-models-sample-model.json</D:href>
        </D:response>
      </D:multistatus>`;
    enqueue([
      { ok: true, status: 207, text: listing },
      { ok: true, status: 200, text: serializeNativeModel(model) },
    ]);
    const repository = new WebDavRepository('https://dav.example/openarch/');
    const summaries = await repository.listModels();
    expect(summaries.length).toBe(1);
    expect(summaries[0].id).toBe(model.id);
  });

  it('round-trips save → get through DAV PUT then GET', async () => {
    const model = createSampleModel();
    const capture: { body?: string } = {};
    const saved = serializeNativeModel(model);
    enqueue(
      [
        { ok: false, status: 404, text: '' }, // existing GET (new file)
        { ok: true, status: 201, text: '' }, // PUT create
        { ok: true, status: 200, text: saved }, // GET after save
      ],
      capture,
    );
    const repository = new WebDavRepository('https://dav.example/openarch');
    await repository.saveModel(model);
    expect(capture.body).toBeTruthy();
    expect(JSON.parse(capture.body!).id).toBe(model.id);
    const read = await repository.getModel(model.id);
    expect(read).toBeTruthy();
    expect(read!.elements.length).toBe(model.elements.length);
  });

  it('drift: a newer remote stamp rejects saving as WebDavDriftError, never silently', async () => {
    const model = createSampleModel();
    const remote = { ...structuredClone(model), updatedAt: '2100-01-01T00:00:00.000Z' };
    enqueue([{ ok: true, status: 200, text: serializeNativeModel(remote) }]);
    const repository = new WebDavRepository('https://dav.example/openarch', () => 'reject');
    await expect(
      repository.saveModel({ ...structuredClone(model), updatedAt: '2000-01-01T00:00:00.000Z' }),
    ).rejects.toBeInstanceOf(WebDavDriftError);
  });
});
