import { describe, expect, it, vi, afterEach } from 'vitest';
import { publish } from './publish';

const baseFlags = {
  url: 'https://co.atlassian.net/wiki',
  space: 'ARCH',
  email: 'a@b.example',
  token: 'tok',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cli publish-confluence', () => {
  it('requires account + instance configuration (exit 1 with a precise list)', async () => {
    const code = await publish('/dev/null', {});
    expect(code).toBe(1);
  });

  it('publishes a native model and prints the page id', async () => {
    const { createSampleModel } = await import('@openarch/core');
    const { serializeNativeModel } = await import('@openarch/repository');
    const { writeFile: write, mkdtemp } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const dir = await mkdtemp(join(tmpdir(), 'openarch-pub-'));
    const file = join(dir, 'model.json');
    await write(file, serializeNativeModel(createSampleModel()));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: '555001' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const writes: string[] = [];
    const originalLog = console.log;
    console.log = (line: string) => writes.push(String(line));
    try {
      const code = await publish(file, { ...baseFlags, 'page-id-file': join(dir, 'page-id') });
      expect(code).toBe(0);
      expect(writes[0]).toContain('555001');
      const stored = await import('node:fs/promises').then((fs) => fs.readFile(join(dir, 'page-id'), 'utf8'));
      expect(stored.trim()).toBe('555001');
      // Confluence got a storage-format fragment (no DOCTYPE/HTML wrapper) + the space key.
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe('https://co.atlassian.net/wiki/rest/api/content');
      const body = JSON.parse(String(init.body));
      expect(body.space.key).toBe('ARCH');
      expect(String(body.body.storage.value)).not.toMatch(/<!doctype/i);
      expect(String(body.body.storage.value)).not.toMatch(/<html/i);
    } finally {
      console.log = originalLog;
    }
  });

  it('reports network failures with exit 2 and the server status', async () => {
    const { createSampleModel } = await import('@openarch/core');
    const { serializeNativeModel } = await import('@openarch/repository');
    const { writeFile: write, mkdtemp } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const dir = await mkdtemp(join(tmpdir(), 'openarch-pub-'));
    const file = join(dir, 'model.json');
    await write(file, serializeNativeModel(createSampleModel()));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401 }),
    );
    const errors: string[] = [];
    const originalError = console.error;
    console.error = (line: string) => errors.push(String(line));
    try {
      const code = await publish(file, baseFlags);
      expect(code).toBe(2);
      expect(errors[0]).toContain('401');
    } finally {
      console.error = originalError;
    }
  });
});
