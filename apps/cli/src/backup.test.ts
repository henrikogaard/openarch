import { createSampleModel } from '@openarch/core';
import { serializeNativeModel } from '@openarch/repository';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anonymiseModelJson, backupData, restoreBackup, verifyStore } from './backup';

/**
 * §12.4 gates for the backup CLI: whole-volume equivalence restore, secrets
 * masking by default, checksum refusal, surgical single-workspace restore, and
 * the anonymise contract (a grep test, not an eyeball check).
 */

function seedStore(dir: string): Promise<void> {
  return mkdir(dir, { recursive: true }).then(async () => {
    const model = createSampleModel();
    const store = [
      {
        id: model.id,
        version: 3,
        updatedAt: '2026-11-20T10:00:00Z',
        updatedBy: 'admin@example.com',
        model: JSON.parse(serializeNativeModel(model)) as Record<string, unknown>,
        members: [{ subject: 'admin@example.com', role: 'owner' }],
        invites: [{ email: 'invitee@example.com', codeHash: 'secret-code-hash' }],
        comments: [{ body: 'private note', author: 'admin@example.com' }],
        audit: [{ actor: 'admin@example.com', action: 'update' }],
      },
    ];
    await writeFile(join(dir, 'models.json'), JSON.stringify(store, null, 2));
    await writeFile(
      join(dir, 'config.json'),
      JSON.stringify({ version: 1, auth: {}, mail: { provider: 'resend', resend: { apiKey: 're_live_SECRET' } } }, null, 2),
    );
    await writeFile(join(dir, 'sessions.json'), JSON.stringify({ sessions: [{ token: 'session-SECRET' }] }));
  });
}

const cli = (args: string[], cwd: string): string =>
  execFileSync('npx', ['tsx', 'apps/cli/src/index.ts', ...args], { cwd, encoding: 'utf8' });

describe('admin backup/restore/verify-store', () => {
  let originalCwd: string;
  beforeAll(() => {
    originalCwd = process.cwd();
  });
  afterAll(() => {
    process.chdir(originalCwd);
  });

  it('round-trips the whole volume into a fresh directory with identical workspace content', async () => {
    const original = join(tmpdir(), 'openarch-backup-src');
    const restoredDir = join(tmpdir(), 'openarch-backup-restore');
    await seedStore(original);
    const { manifest, file } = await backupData(original);
    expect(manifest.files.some((entry) => entry.path === 'models.json')).toBe(true);

    const report = await restoreBackup(file, restoredDir, {});
    expect(report.restoredWorkspaces).toBe(1);
    expect(report.dryRun).toBe(false);

    // Equivalence: models.json parses identically in both places.
    const before = await readFile(join(original, 'models.json'), 'utf8');
    const after = await readFile(join(restoredDir, 'models.json'), 'utf8');
    expect(JSON.parse(after)).toEqual(JSON.parse(before));

    await verifyStore(restoredDir).then((result) => {
      expect(result.ok).toBe(true);
      expect(result.workspaceCount).toBe(1);
    });
  });

  it('masks secrets by default and includes them only with --include-secrets', async () => {
    const dir = join(tmpdir(), 'openarch-backup-secrets');
    await seedStore(dir);
    const { manifest, file } = await backupData(dir);
    expect(manifest.secrets).toBe(false);
    // sessions.json excluded entirely.
    expect(manifest.files.some((entry) => entry.path === 'sessions.json')).toBe(false);
    // config's API key blanked.
    const { unzipSync, strFromU8 } = await import('fflate');
    const entries = unzipSync(await readFile(file));
    const config = JSON.parse(strFromU8(entries['config.json'])) as {
      mail: { resend: { apiKey?: string } };
    };
    expect(config.mail.resend.apiKey).toBe('');

    const withSecrets = await backupData(dir, { includeSecrets: true });
    expect(withSecrets.manifest.secrets).toBe(true);
    expect(withSecrets.manifest.files.some((entry) => entry.path === 'sessions.json')).toBe(true);
  });

  it('refuses restore when a checksum mismatches (tamper detection)', async () => {
    const dir = join(tmpdir(), 'openarch-backup-tamper-src');
    await seedStore(dir);
    const { file } = await backupData(dir);
    const { unzipSync, zipSync, strFromU8, strToU8 } = await import('fflate');
    const raw = await readFile(file);
    const entries = unzipSync(raw);
    // Tamper with models.json but keep the manifest.
    entries['models.json'] = strToU8(strFromU8(entries['models.json']).replace('"version": 3', '"version": 99'));
    const tampered = Buffer.from(zipSync(entries));
    const tamperedPath = file.replace('.zip', '-tampered.zip');
    await writeFile(tamperedPath, tampered);
    await expect(restoreBackup(tamperedPath, join(tmpdir(), 'openarch-backup-tamper-dst'), {})).rejects.toThrow(
      /checksum mismatch/,
    );
  });

  it('restores a single workspace surgically without touching others', async () => {
    const original = join(tmpdir(), 'openarch-backup-surgical-src');
    await mkdir(original, { recursive: true });
    const modelA = createSampleModel();
    const modelB = createSampleModel();
    modelB.id = 'model-b';
    const store = [
      { id: modelA.id, version: 1, model: JSON.parse(serializeNativeModel(modelA)), members: [] },
      { id: modelB.id, version: 9, model: JSON.parse(serializeNativeModel(modelB)), members: [] },
    ];
    await writeFile(join(original, 'models.json'), JSON.stringify(store, null, 2));

    const { file } = await backupData(original);
    const destination = join(tmpdir(), 'openarch-backup-surgical-dst');
    await mkdir(destination, { recursive: true });
    // Destination has a NEWER live copy of model-b; surgical restore of
    // model-a must leave model-b's live copy untouched.
    const storeLive = [
      { id: modelA.id, version: 5, model: JSON.parse(serializeNativeModel(modelA)), members: [] },
      { id: modelB.id, version: 42, model: JSON.parse(serializeNativeModel(modelB)), members: [] },
    ];
    await writeFile(join(destination, 'models.json'), JSON.stringify(storeLive, null, 2));

    const report = await restoreBackup(file, destination, { workspace: modelA.id });
    expect(report.restoredWorkspaces).toBe(1);
    const restored = JSON.parse(await readFile(join(destination, 'models.json'), 'utf8')) as Array<{
      id: string;
      version: number;
    }>;
    const a = restored.find((workspace) => workspace.id === modelA.id);
    const b = restored.find((workspace) => workspace.id === 'model-b');
    expect(a?.version).toBe(1); // from the backup
    expect(b?.version).toBe(42); // live copy untouched
  });

  it('--anonymise scrubs subjects, comments, audit, invites (grep contract)', async () => {
    const dir = join(tmpdir(), 'openarch-backup-anon-src');
    await seedStore(dir);
    const { manifest, file } = await backupData(dir, { anonymise: true });
    expect(manifest.anonymised).toBe(true);
    const { unzipSync, strFromU8 } = await import('fflate');
    const entries = unzipSync(await readFile(file));
    // §12.4's "redaction grep" runs on DECOMPRESSED content, entry by entry.
    const content = Object.entries(entries)
      .map(([name, bytes]) => `${name}: ${name.endsWith('.json') ? strFromU8(bytes) : '<<binary>>'}`)
      .join('\n');
    expect(content.includes('admin@example.com')).toBe(false);
    expect(content.includes('invitee@example.com')).toBe(false);
    expect(content.includes('secret-code-hash')).toBe(false);
    expect(content.includes('private note')).toBe(false);
    // Subjects survive as opaque user-N.
    expect(content.includes('user-1')).toBe(true);
    // But the architecture survived (element names present).
    expect(content.includes('Claims Portal')).toBe(true);
  });

  it('dry-run report matches a real restore count and writes nothing', async () => {
    const original = join(tmpdir(), 'openarch-backup-dryrun-src');
    await seedStore(original);
    const { file } = await backupData(original);
    const destination = join(tmpdir(), 'openarch-backup-dryrun-dst');
    await mkdir(destination, { recursive: true });
    const report = await restoreBackup(file, destination, { dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(report.restoredWorkspaces).toBe(1);
    // Nothing was written: the directory has no models.json.
    const listing = await readdir(destination);
    expect(listing).toEqual([]);
  });

  it('verify-store flags a corrupt store and approves an empty one', async () => {
    const corrupt = join(tmpdir(), 'openarch-backup-corrupt');
    await mkdir(corrupt, { recursive: true });
    await writeFile(join(corrupt, 'models.json'), '{ this is not json');
    const bad = await verifyStore(corrupt);
    expect(bad.ok).toBe(false);

    const empty = join(tmpdir(), 'openarch-backup-empty-' + Date.now());
    await mkdir(empty, { recursive: true });
    const none = await verifyStore(empty);
    expect(none.ok).toBe(true);
    expect(none.workspaceCount).toBe(0);
  });

  it('CLI commands expose the flow (backup → verify → restore --dry-run)', async () => {
    const dir = join(tmpdir(), 'openarch-backup-cli-src');
    await seedStore(dir);
    const backup = await backupData(dir, {});
    const output = cli(['admin', 'verify-store', dir], process.cwd());
    expect(output).toContain('Verify-store:');
    expect(output).toContain('ok=true');
    const dry = cli(['admin', 'restore', backup.file, dir, '--workspace', 'sample-model', '--dry-run'], process.cwd());
    expect(dry).toContain('(dry run)');
    expect(dry).toContain('1 workspace');
  });
});
