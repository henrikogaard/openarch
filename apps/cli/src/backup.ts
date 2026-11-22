import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';

/**
 * `openarch admin backup/restore/verify-store` (spec §B2 + plan §12).
 *
 * Backup = a zip of the server's data directory with excluded secret files by
 * default, plus a sha256 manifest every restore verifies. Works against the
 * current whole-model store (`models.json`); the event-sourced layout is a
 * non-blocking extension in Track C. `--at` is accepted and refused with a
 * stable message until lands, so the flag surface is stable from day one.
 */
export const BACKUP_FORMAT_VERSION = 1;

export interface BackupOptions {
  includeSecrets?: boolean;
  anonymise?: boolean;
}

export interface RestoreOptions {
  workspace?: string;
  at?: string;
  dryRun?: boolean;
}

export interface BackupManifest {
  format: 'openarch-backup';
  formatVersion: number;
  createdAt: string;
  secrets: boolean;
  anonymised: boolean;
  files: Array<{ path: string; bytes: number; sha256: string }>;
}

/** Data files never included by default (spec: sessions & OTP state are ephemeral). */
const SECRET_FILES = ['sessions.json'];
/** Config carries mail API keys — masked from backups unless --include-secrets. */
const SECRET_MASK_FILE = 'config.json';

export function sha256Of(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** The runnable form of §12's anonymise: preserve architecture, strip people. */
export function anonymiseModelJson(text: string): string {
  const data = JSON.parse(text) as Array<Record<string, unknown>>;
  const subjectMap = new Map<string, string>();
  const anon = (subject: unknown): unknown => {
    if (typeof subject !== 'string' || !subject.trim()) return subject;
    const key = subject.toLowerCase();
    if (!subjectMap.has(key)) subjectMap.set(key, `user-${subjectMap.size + 1}`);
    return subjectMap.get(key);
  };
  return JSON.stringify(
    data.map((workspace) => ({
      ...workspace,
      // People-scrub membership; wipe conversational/ephemeral/governance data.
      updatedBy: anon(workspace.updatedBy),
      members: ((workspace.members as Array<Record<string, unknown>>) ?? []).map((member) => ({
        ...member,
        subject: anon(member.subject),
      })),
      invites: [] as unknown[],
      comments: [] as unknown[],
      audit: [] as unknown[],
      groupRoles: [] as unknown[],
      model:
        workspace.model && typeof workspace.model === 'object'
          ? { ...(workspace.model as Record<string, unknown>), approvals: [] as unknown[] }
          : workspace.model,
    })),
    null,
    2,
  );
}

export async function backupData(dataDir: string, options: BackupOptions = {}): Promise<{ file: string; manifest: BackupManifest }> {
  const files: BackupManifest['files'] = [];
  const zipPayload: Record<string, Uint8Array> = {};
  const entries = await readdir(dataDir, { withFileTypes: true }).catch(() => [] as never[]);
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    let bytes: Buffer = await readFile(join(dataDir, name));
    let skip = false;
    if (SECRET_FILES.includes(name) && !options.includeSecrets) skip = true;
    if (name === SECRET_MASK_FILE && !options.includeSecrets) {
      // Keep config (retention/provider) but blank key material by default.
      const config = JSON.parse(strFromU8(bytes)) as {
        mail?: Record<string, { apiKey?: string; pass?: string }>;
      };
      const masked = structuredClone(config);
      if (masked.mail?.resend) masked.mail.resend.apiKey = '';
      if (masked.mail?.smtp) masked.mail.smtp.pass = '';
      bytes = Buffer.from(strToU8(JSON.stringify(masked, null, 2)));
    }
    if (options.anonymise && name.endsWith('.json') && !name.includes('users')) {
      try {
        bytes = Buffer.from(strToU8(anonymiseModelJson(strFromU8(bytes))));
      } catch {
        // Not a workspace-array JSON — anonymise skips it (e.g. summaries).
      }
    }
    if (skip) continue;
    files.push({ path: name, bytes: bytes.byteLength, sha256: sha256Of(bytes) });
    zipPayload[name] = bytes;
  }
  const manifest: BackupManifest = {
    format: 'openarch-backup',
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    secrets: Boolean(options.includeSecrets),
    anonymised: Boolean(options.anonymise),
    files,
  };
  zipPayload['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  const zipped = zipSync(zipPayload, { level: 6 });
  const stamp = manifest.createdAt.replace(/[:.]/g, '-');
  const file = `openarch-backup-${stamp}.zip`;
  await writeFile(file, zipped);
  return { file, manifest };
}

export interface RestoreReport {
  restoredWorkspaces: number;
  dryRun: boolean;
  warnings: string[];
}

export async function restoreBackup(
  archive: string,
  dataDir: string,
  options: RestoreOptions = {},
): Promise<RestoreReport> {
  const warnings: string[] = [];
  if (options.at) {
    throw new Error('--at requires the event-source store (coming in Track C); the flag surface is stable');
  }
  const archiveBytes = await readFile(archive);
  // §-compliant tarball? We only accept the §12 zip format.
  const entries = unzipSync(archiveBytes);
  const manifest = JSON.parse(strFromU8(entries['manifest.json'])) as BackupManifest;
  if (manifest.format !== 'openarch-backup') throw new Error('Not an OpenArch backup (missing manifest)');  for (const recorded of manifest.files) {
    const bytes = entries[recorded.path];
    if (!bytes) throw new Error(`Restore refused: archive is missing ${recorded.path}`);
    if (sha256Of(bytes) !== recorded.sha256) {
      throw new Error(`Restore refused: checksum mismatch for ${recorded.path}`);
    }
  }
  const targetDir = resolve(dataDir);
  if (options.dryRun) {
    return { restoredWorkspaces: countWorkspaces(entries, manifest, options.workspace), dryRun: true, warnings };
  }
  await mkdir(targetDir, { recursive: true });
  for (const recorded of manifest.files) {
    if (options.workspace && recorded.path !== 'models.json') continue;
    const bytes = entries[recorded.path];
    if (options.workspace && recorded.path === 'models.json') {
      // Surgical: keep other workspaces, replace only the named one.
      const present = await readFile(join(targetDir, recorded.path), 'utf8').catch(() => '[]');
      const current = JSON.parse(present || '[]') as Array<Record<string, unknown>>;
      const incoming = JSON.parse(strFromU8(bytes)) as Array<Record<string, unknown>>;
      const replacement = incoming.find((workspace) => String(workspace.id) === options.workspace);
      if (!replacement) throw new Error(`Workspace ${options.workspace} not present in the backup`);
      const merged = current.filter((workspace) => String(workspace.id) !== options.workspace);
      merged.push(replacement);
      await writeFile(join(targetDir, recorded.path), JSON.stringify(merged, null, 2));
    } else {
      await writeFile(join(targetDir, recorded.path), bytes);
    }
  }
  warnings.push(`Restored ${manifest.files.length} file(s) into ${relative(process.cwd(), targetDir) || targetDir}`);
  return {
    restoredWorkspaces: countWorkspaces(entries, manifest, options.workspace),
    dryRun: false,
    warnings,
  };
}

function countWorkspaces(
  entries: Record<string, Uint8Array>,
  manifest: BackupManifest,
  workspaceFilter?: string,
): number {
  if (!manifest.files.some((file) => file.path === 'models.json')) return 0;
  if (!entries['models.json']) return 0;
  try {
    const models = JSON.parse(strFromU8(entries['models.json'])) as Array<Record<string, unknown>>;
    if (workspaceFilter) {
      return models.some((model) => String(model.id) === workspaceFilter) ? 1 : 0;
    }
    return models.length;
  } catch {
    return 0;
  }
}

export interface VerifyReport {
  workspaceCount: number;
  ok: boolean;
  warnings: string[];
}

/**
 * `verify-store`: boot-check the current store — parse, per-workspace validate
 * the newest snapshot against the model, and report. With the whole-model
 * store the newest "snapshot" IS the workspace model; Track C extends this
 * to event replay against snapshots.
 */
export async function verifyStore(dataDir: string): Promise<VerifyReport> {
  const warnings: string[] = [];
  const modelsPath = join(dataDir, 'models.json');
  let raw: string;
  try {
    raw = await readFile(modelsPath, 'utf8');
  } catch {
    return { workspaceCount: 0, ok: true, warnings: [`No ${modelsPath} — empty store verified as empty`] };
  }
  let data: Array<Record<string, unknown>>;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    return {
      workspaceCount: 0,
      ok: false,
      warnings: [
        `Corrupt models.json (parse failed: ${error instanceof Error ? error.message : String(error)})`,
      ],
    };
  }
  if (!Array.isArray(data)) {
    return { workspaceCount: 0, ok: false, warnings: ['models.json is not a workspace array'] };
  }
  let ok = true;
  for (const workspace of data) {
    const model = workspace.model as { id?: string } | undefined;
    if (!model?.id) {
      ok = false;
      warnings.push(`Workspace record without a model.id skipped: ${JSON.stringify(workspace).slice(0, 80)}`);
    }
  }
  return { workspaceCount: data.length, ok, warnings };
}
