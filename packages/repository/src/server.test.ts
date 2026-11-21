import { createSampleModel, type Model } from '@openarch/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServerRepository } from './server';

/** Route-level fetch mock for ServerRepository — the adapter had zero tests. */
function mockFetch(routes: Record<string, { status: number; body?: unknown }>): MockFetch {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = vi.fn(async (url: unknown, init?: RequestInit) => {
    const href = String(url);
    calls.push({ url: href, init });
    const method = ((init?.method as string | undefined) ?? 'GET').toUpperCase();
    // Match by method then longest matching path prefix.
    const route =
      Object.entries(routes).find(([key]) => {
        const [routeMethod, path] = key.split(' ');
        return routeMethod.toUpperCase() === method && href.includes(path);
      })?.[1];
    if (!route) {
      throw new Error(`missing route mock for ${method} ${href}`);
    }
    return new Response(JSON.stringify(route.body ?? {}), {
      status: route.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  const implMock = (impl as unknown) as ReturnType<typeof vi.fn>;
  vi.stubGlobal('fetch', impl);
  return { calls, impl: implMock };
}

interface MockFetch {
  calls: Array<{ url: string; init?: RequestInit }>;
  impl: ReturnType<typeof vi.fn>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ServerRepository', () => {
  it('creates new workspaces through POST /models (server mode is usable)', async () => {
    const { calls } = mockFetch({
      'GET /': { status: 404 },
      'PUT /models': { status: 404 },
      'POST /models': { status: 201, body: {} },
    });
    const repo = new ServerRepository('http://x/api');
    const sample = createSampleModel();
    await repo.saveModel(sample); // no version on hand → create path
    const post = calls.find((call) => call.init?.method === 'POST');
    expect(post?.url).toContain('/api/models');
    expect(JSON.parse(String(post?.init?.body)).id).toBe(sample.id);
    expect(calls.some((call) => call.url.includes('/meta'))).toBe(true);
  });

  it('updates with If-Match and refuses to clobber a newer server copy', async () => {
    const sample = createSampleModel();
    const { calls } = mockFetch({
      'GET /meta': { status: 200, body: { version: 7, updatedAt: '2026-01-02T00:00:00Z', updatedBy: 'b', commentCount: 0, snapshotCount: 0 } },
      'PUT /models': { status: 200, body: sample },
    });
    const repo = new ServerRepository('http://x/api');
    // Our copy stamps an OLDER save than the server's → conflict, no PUT.
    const older = { ...sample, updatedAt: '2026-01-01T00:00:00Z' } as Model;
    await expect(repo.saveModel(older)).rejects.toThrow(/Conflict/);
    expect(calls.some((call) => call.init?.method === 'PUT')).toBe(false);

    // A model the server has NEVER stamped (undefined) cannot be stale → PUT proceeds.
    const fresh = { ...sample } as Model; // no updatedAt
    await repo.saveModel(fresh, 7);
    const put = calls.find((call) => call.init?.method === 'PUT');
    expect(put?.init?.headers).toMatchObject({ 'if-match': '7' });
  });

  it('passes explicit versions through as If-Match', async () => {
    const sample = createSampleModel();
    const { calls } = mockFetch({
      'PUT /models': { status: 200, body: sample },
    });
    const repo = new ServerRepository('http://x/api');
    await repo.saveModel(sample, 12);
    const put = calls.find((call) => call.init?.method === 'PUT');
    expect(put?.init?.headers).toMatchObject({ 'if-match': '12' });
  });

  it('surfaces 409 payloads as typed conflicts with currentVersion', async () => {
    mockFetch({
      'PUT /models': {
        status: 409,
        body: { error: 'Conflict: workspace changed', currentVersion: 9, current: { id: 'm' } },
      },
    });
    const repo = new ServerRepository('http://x/api');
    try {
      await repo.saveModel(createSampleModel(), 3);
      expect.unreachable('saveModel should have thrown');
    } catch (error) {
      const conflict = error as Error & { currentVersion?: number };
      expect(conflict.message).toMatch(/Conflict/);
      expect(conflict.currentVersion).toBe(9);
    }
  });

  it('observes timeouts on requests', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: unknown, init?: RequestInit) => {
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        return Promise.resolve(new Response('[]', { status: 200 }));
      }),
    );
    const repo = new ServerRepository('http://x/api');
    await repo.listModels();
  });
});
