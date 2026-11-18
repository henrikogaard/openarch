import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Boots the real server process and exercises the HTTP surface end to end:
 * authentication, RBAC, optimistic locking, saved views, and import preview.
 */

const port = 18000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;
const dataDirectory = mkdtempSync(join(tmpdir(), 'openarch-server-'));
let server: ChildProcess | undefined;

const admin = { Authorization: 'Bearer admin-token' };
const viewer = { Authorization: 'Bearer viewer-token' };
const stranger = { Authorization: 'Bearer stranger-token' };

async function waitForHealth(timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Server did not become healthy in time');
}

async function json<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const response = await fetch(`${base}${path}`, init);
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : undefined) as T };
}

beforeAll(async () => {
  server = spawn('npx', ['tsx', 'apps/server/src/index.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      OPENARCH_DATA: join(dataDirectory, 'models.json'),
      OPENARCH_REQUIRE_AUTH: 'true',
      OPENARCH_ADMIN: 'admin',
      OPENARCH_TOKENS: JSON.stringify({
        'admin-token': { subject: 'admin', displayName: 'Admin' },
        'viewer-token': { subject: 'viewer', displayName: 'Viewer' },
        'stranger-token': { subject: 'stranger', displayName: 'Stranger' },
      }),
    },
    stdio: 'ignore',
  });
  await waitForHealth();
}, 45000);

afterAll(() => {
  server?.kill('SIGTERM');
});

describe('server integration', () => {
  it('rejects unauthenticated requests when auth is required', async () => {
    const response = await fetch(`${base}/api/models`);
    expect(response.status).toBe(401);
  });

  it('reports the effective role per workspace', async () => {
    const { status, body } = await json<{ subject: string; roles: Record<string, string> }>(
      '/api/me',
      { headers: admin },
    );
    expect(status).toBe(200);
    expect(body.subject).toBe('admin');
    expect(Object.values(body.roles)).toContain('owner');
  });

  it('isolates reads to workspace members', async () => {
    const adminModels = await json<unknown[]>('/api/models', { headers: admin });
    expect(adminModels.body.length).toBe(1);

    const strangerModels = await json<unknown[]>('/api/models', { headers: stranger });
    expect(strangerModels.status).toBe(200);
    expect(strangerModels.body).toEqual([]);

    const strangerRead = await json<{ error: string }>('/api/models/sample-model', {
      headers: stranger,
    });
    expect(strangerRead.status).toBe(403);
  });

  it('lets viewers read but not write', async () => {
    // Add the viewer as a member so they can read the workspace.
    const members = await json<unknown[]>('/api/models/sample-model/members/viewer', {
      method: 'PUT',
      headers: { ...admin, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'viewer' }),
    });
    expect(members.status).toBe(200);

    const read = await json<unknown>('/api/models/sample-model', { headers: viewer });
    expect(read.status).toBe(200);

    const write = await json<{ error: string }>('/api/models/sample-model', {
      method: 'PUT',
      headers: { ...viewer, 'content-type': 'application/json' },
      body: JSON.stringify(read.body),
    });
    expect(write.status).toBe(403);
  });

  it('rejects a stale write with 409 and accepts the current version', async () => {
    const model = await json<Record<string, unknown>>('/api/models/sample-model', {
      headers: admin,
    });
    expect(model.status).toBe(200);

    const stale = await json<{ error: string }>('/api/models/sample-model', {
      method: 'PUT',
      headers: { ...admin, 'content-type': 'application/json', 'if-match': '999' },
      body: JSON.stringify(model.body),
    });
    expect(stale.status).toBe(409);

    const meta = await json<{ version: number }>('/api/models/sample-model/meta', {
      headers: admin,
    });
    const current = await json<Record<string, unknown>>('/api/models/sample-model', {
      method: 'PUT',
      headers: {
        ...admin,
        'content-type': 'application/json',
        'if-match': String(meta.body.version),
      },
      body: JSON.stringify(model.body),
    });
    expect(current.status).toBe(200);
  });

  it('keeps a version history: saves create snapshots, restore reverts, 409 carries currentVersion', async () => {
    const model = await json<Record<string, unknown>>('/api/models/sample-model', { headers: admin });
    expect(model.status).toBe(200);
    const base = model.body as { elements?: unknown[] };

    // Each save creates a revision snapshot.
    const save = (body: unknown, version: number) =>
      json('/api/models/sample-model', {
        method: 'PUT',
        headers: { ...admin, 'content-type': 'application/json', 'if-match': String(version) },
        body: JSON.stringify(body),
      });
    const meta1 = await json<{ version: number }>('/api/models/sample-model/meta', { headers: admin });
    await save(base, meta1.body.version);
    const meta2 = await json<{ version: number }>('/api/models/sample-model/meta', { headers: admin });
    const modified = { ...base, elements: [...(base.elements ?? []), { id: 'added', type: 'Node', name: [{ lang: 'en', value: 'Added' }], documentation: [], properties: [] }] };
    await save(modified, meta2.body.version);

    const snapshots = await json<Array<{ id: string; version: number; label: string }>>(
      '/api/models/sample-model/snapshots',
      { headers: admin },
    );
    expect(snapshots.status).toBe(200);
    expect(snapshots.body.length).toBeGreaterThanOrEqual(2);
    const latest = snapshots.body[snapshots.body.length - 1];

    // Full snapshot fetch returns the model.
    const full = await json<{ model: { elements?: unknown[] } }>(
      `/api/models/sample-model/snapshots/${latest.id}`,
      { headers: admin },
    );
    expect(full.status).toBe(200);
    expect(full.body.model.elements?.some((e) => (e as { id: string }).id === 'added')).toBe(true);

    // Stale write → 409 with currentVersion.
    const stale = await json<{ error: string; currentVersion: number }>('/api/models/sample-model', {
      method: 'PUT',
      headers: { ...admin, 'content-type': 'application/json', 'if-match': String(meta1.body.version) },
      body: JSON.stringify(modified),
    });
    expect(stale.status).toBe(409);
    expect(stale.body.currentVersion).toBeGreaterThan(meta1.body.version);

    // Restore the earlier snapshot → model loses the added element, version bumps.
    const earlier = snapshots.body[snapshots.body.length - 2];
    const restored = await json<{ elements?: unknown[] }>(
      `/api/models/sample-model/snapshots/${earlier.id}/restore`,
      { method: 'POST', headers: admin },
    );
    expect(restored.status).toBe(200);
    expect(restored.body.elements?.some((e) => (e as { id: string }).id === 'added')).toBe(false);
    const meta3 = await json<{ version: number }>('/api/models/sample-model/meta', { headers: admin });
    expect(meta3.body.version).toBeGreaterThan(meta2.body.version);
  });

  it('persists and deletes saved views', async () => {
    const created = await json<{ id: string }>('/api/models/sample-model/saved-views', {
      method: 'POST',
      headers: { ...admin, 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'view-1',
        name: 'Claims focus',
        modelId: 'sample-model',
        kind: 'dashboard',
        filters: { query: 'claim' },
        createdAt: new Date().toISOString(),
      }),
    });
    expect(created.status).toBe(201);

    const listed = await json<Array<{ id: string }>>('/api/models/sample-model/saved-views', {
      headers: admin,
    });
    expect(listed.body.map((view) => view.id)).toContain('view-1');

    const removed = await fetch(`${base}/api/models/sample-model/saved-views/view-1`, {
      method: 'DELETE',
      headers: admin,
    });
    expect(removed.status).toBe(204);
  });

  it('previews an import without writing and applies it with merge', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.opengroup.org/xsd/archimate/3.0/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" identifier="incoming">
  <name xml:lang="en">Incoming</name>
  <elements>
    <element identifier="imported-goal" xsi:type="Goal"><name xml:lang="en">Imported goal</name></element>
  </elements>
</model>`;

    const before = await json<{ elements: unknown[] }>('/api/models/sample-model', {
      headers: admin,
    });

    const preview = await json<{ summary: string; diff: { addedElements: string[] } }>(
      '/api/models/sample-model/import/preview',
      {
        method: 'POST',
        headers: { ...admin, 'content-type': 'application/json' },
        body: JSON.stringify({ xml }),
      },
    );
    expect(preview.status).toBe(200);
    expect(preview.body.diff.addedElements.join(' ')).toContain('imported-goal');

    const unchanged = await json<{ elements: unknown[] }>('/api/models/sample-model', {
      headers: admin,
    });
    expect(unchanged.body.elements.length).toBe(before.body.elements.length);

    const applied = await json<{ summary: string }>('/api/models/sample-model/import/apply', {
      method: 'POST',
      headers: { ...admin, 'content-type': 'application/json' },
      body: JSON.stringify({ xml, mode: 'merge' }),
    });
    expect(applied.status).toBe(200);

    const after = await json<{ elements: Array<{ id: string }> }>('/api/models/sample-model', {
      headers: admin,
    });
    expect(after.body.elements.some((element) => element.id === 'imported-goal')).toBe(true);
  });

  it('exposes AI context and validation over HTTP', async () => {
    const context = await json<{ markdown: string }>('/api/ai/context/sample-model', {
      headers: admin,
    });
    expect(context.status).toBe(200);
    expect(context.body.markdown).toContain('Sample insurance model');

    const validation = await json<{ issues: unknown[] }>('/api/ai/validate/sample-model', {
      method: 'POST',
      headers: admin,
    });
    expect(validation.status).toBe(200);
    expect(Array.isArray(validation.body.issues)).toBe(true);
  });
});
