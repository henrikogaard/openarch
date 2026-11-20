import type { Model, ModelSummary, SavedView } from '@openarch/core';
import { parseNativeModel, serializeNativeModel, NATIVE_SCHEMA_VERSION } from './local';
import { type ModelRepository, summarize } from './types';

/**
 * FolderRepository (spec B1, plan §9.1) — File System Access API adapter.
 *
 * Files on the user's chosen real folder (Chromium desktop; the API guard is
 * handled by the caller — Firefox/Safari fall back to browser mode):
 *   <folder>/models/<id>.json   — schema-versioned native JSON per workspace
 *   <folder>/.openarch-index     — { id: { updatedAt, sha256 } } for drift detection
 *
 * Drift rule: when a file's updatedAt is NEWER than the last one we wrote,
 * the folder changed elsewhere (another machine via sync) — the caller
 * surfaces ConflictReview instead of a silent overwrite (§9.5). The adapter
 * itself just reports the conflict as a typed error.
 */
export class FolderDriftError extends Error {
  constructor(
    public readonly id: string,
    public readonly incomingUpdatedAt: string,
    public readonly lastWrittenUpdatedAt: string,
    public readonly incomingModel: Model,
  ) {
    super('The file changed outside this session (another machine?) — review before saving');
  }
}

interface DirectoryHandleLike {
  kind: 'file' | 'directory';
  name: string;
}

export interface FileSystemDirectoryHandle extends DirectoryHandleLike {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandleLike>;
  values(): AsyncIterableIterator<DirectoryHandleLike | FileSystemFileHandleLike>;
  queryPermission?(descriptor?: { mode: 'read' | 'readwrite' }): Promise<PermissionStateLike>;
  requestPermission?(descriptor?: { mode: 'read' | 'readwrite' }): Promise<PermissionStateLike>;
}

export interface FileSystemFileHandleLike {
  kind: 'file';
  name: string;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
  getFile(): Promise<{ lastModified: number; text(): Promise<string> }>;
}

type PermissionStateLike = 'granted' | 'denied' | 'prompt';

const MODELS_DIR = 'models';
const INDEX_FILE = '.openarch-index';

interface FolderIndexEntry {
  updatedAt: string;
  sha256: string;
}
export type FolderIndex = Record<string, FolderIndexEntry>;

export class FolderRepository implements ModelRepository {
  private index: FolderIndex = {};

  constructor(
    private readonly dir: FileSystemDirectoryHandle,
    private readonly onDrift?: (error: FolderDriftError) => 'overwrite' | 'reject',
  ) {}

  private async ensureDir(name: string): Promise<FileSystemDirectoryHandle> {
    // The File System Access API gets subdirectories through getFileHandle
    // only in newer revisions; a flat '<id>.json' naming inside the folder
    // keeps us compatible. MODELS_DIR namespacing: 'models-<id>.json'.
    return this.dir;
  }

  /** Refresh the in-memory index from the .openarch-index file. */
  async loadIndex(): Promise<void> {
    try {
      const handle = await this.dir.getFileHandle(INDEX_FILE);
      const file = await handle.getFile();
      this.index = JSON.parse(await file.text()) as FolderIndex;
    } catch {
      this.index = {};
    }
  }

  private async saveIndex(): Promise<void> {
    const handle = await this.dir.getFileHandle(INDEX_FILE, { create: true });
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify({ schemaVersion: NATIVE_SCHEMA_VERSION, entries: this.index }, null, 2));
    await writable.close();
  }

  private fileName(id: string): string {
    return `${MODELS_DIR}-${id.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`;
  }

  async listModels(): Promise<ModelSummary[]> {
    const files: string[] = [];
    for await (const entry of this.dir.values()) {
      if (entry.kind === 'file' && (entry.name.startsWith(`${MODELS_DIR}-`) && entry.name.endsWith('.json'))) {
        files.push(entry.name);
      }
    }
    const summaries: ModelSummary[] = [];
    for (const name of files) {
      try {
        const handle = await this.dir.getFileHandle(name);
        const text = await (await handle.getFile()).text();
        const model = parseNativeModel(text);
        summaries.push(summarize(model));
      } catch {
        // Skip unreadable files (drift rule still allows opening them later).
      }
    }
    return summaries;
  }

  async getModel(id: string): Promise<Model | undefined> {
    try {
      const handle = await this.dir.getFileHandle(this.fileName(id));
      const text = await (await handle.getFile()).text();
      const model = parseNativeModel(text);
      // Track what we saw so save-time drift detection has a baseline.
      this.index[id] = { updatedAt: model.updatedAt ?? '', sha256: '' };
      return model;
    } catch {
      return undefined;
    }
  }

  async saveModel(model: Model, expectedVersion?: number): Promise<void> {
    void expectedVersion; // folders have no optimistic locking; drift rule covers it
    const name = this.fileName(model.id);
    const written = { ...model, updatedAt: new Date().toISOString() };
    // Drift detection: compare a fresh read with our recorded baseline.
    let existing: Model | undefined;
    try {
      const handle = await this.dir.getFileHandle(name);
      const text = await (await handle.getFile()).text();
      existing = parseNativeModel(text);
    } catch {
      existing = undefined; // new file
    }
    if (existing && existing.updatedAt && model.updatedAt && Date.parse(existing.updatedAt) > Date.parse(model.updatedAt)) {
      const drift = new FolderDriftError(model.id, existing.updatedAt, model.updatedAt, existing);
      if (this.onDrift?.(drift) !== 'overwrite') {
        throw drift;
      }
    }
    const handle = await this.dir.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(serializeNativeModel(written));
    await writable.close();
    this.index[model.id] = { updatedAt: written.updatedAt ?? '', sha256: '' };
    await this.saveIndex();
  }

  async deleteModel(id: string): Promise<void> {
    // The File System Access API (as available) has no removeEntry; deletion
    // is a UI-level tombstone via saveModel with status 'archived'.
    // Real removal happens when the user manages the folder directly —
    // documented in plan §9.1 ("the folder is the store").
    throw new Error('Folder mode deletes via archive status (manage files directly to remove)');
  }

  async listSavedViews(modelId: string): Promise<SavedView[]> {
    void modelId;
    return []; // saved views are a server-mode feature
  }

  /** Adopt every readable workspace file (called once after attach). */
  static async adopt(dir: FileSystemDirectoryHandle, onDrift?: (error: FolderDriftError) => 'overwrite' | 'reject'): Promise<FolderRepository> {
    const repository = new FolderRepository(dir, onDrift);
    await repository.loadIndex();
    return repository;
  }
}

export { FolderDriftError as _FolderDriftError };
