import type { Model, SavedView } from '@openarch/core';
import { createStore, del, get, keys, set } from 'idb-keyval';
import { type ModelRepository, summarize } from './types';

const modelStore = createStore('openarch', 'models');
const savedViewStore = createStore('openarch', 'saved-views');

/** Default adapter: models live in the browser, no account and no server. */
export class LocalRepository implements ModelRepository {
  async listModels() {
    const ids = (await keys(modelStore)).filter((id): id is string => typeof id === 'string');
    const models = await Promise.all(ids.map((id) => get<Model>(id, modelStore)));
    return models.filter((model): model is Model => Boolean(model)).map(summarize);
  }

  getModel(id: string): Promise<Model | undefined> {
    return get<Model>(id, modelStore);
  }

  async saveModel(model: Model, expectedVersion?: number): Promise<void> {
    void expectedVersion;
    // Stamp the save time so the workspace list can show recency.
    await set(model.id, { ...model, updatedAt: new Date().toISOString() }, modelStore);
  }

  async deleteModel(id: string): Promise<void> {
    await del(id, modelStore);
  }

  async listSavedViews(modelId: string): Promise<SavedView[]> {
    const ids = (await keys(savedViewStore)).filter((id): id is string => typeof id === 'string');
    const all = await Promise.all(ids.map((id) => get<SavedView>(id, savedViewStore)));
    return all
      .filter((view): view is SavedView => Boolean(view))
      .filter((view) => view.modelId === modelId);
  }

  async saveSavedView(view: SavedView): Promise<SavedView> {
    await set(view.id, view, savedViewStore);
    return view;
  }

  async deleteSavedView(modelId: string, viewId: string): Promise<void> {
    void modelId;
    await del(viewId, savedViewStore);
  }
}

/** Human-readable, Git-friendly native format (no XML passthrough payload). */
export const NATIVE_SCHEMA_VERSION = 1;

export function serializeNativeModel(model: Model): string {
  return `${JSON.stringify({ schemaVersion: NATIVE_SCHEMA_VERSION, ...model }, replacer, 2)}\n`;
}

/**
 * Parse a native model file, migrating older schema versions forward.
 * Version 0 (no `schemaVersion`) predates the field; today that is the same
 * shape, but the hook is here so future migrations have a place to live.
 */
export function parseNativeModel(json: string): Model {
  const parsed = JSON.parse(json) as Model & { schemaVersion?: number };
  if (!parsed || typeof parsed.id !== 'string' || !Array.isArray(parsed.elements)) {
    throw new Error('Not an OpenArch native model file');
  }
  const version = parsed.schemaVersion ?? 0;
  if (version > NATIVE_SCHEMA_VERSION) {
    throw new Error(`Native model schema v${version} is newer than this app supports (v${NATIVE_SCHEMA_VERSION})`);
  }
  const model = migrateNativeModel(parsed, version);
  return model;
}

function migrateNativeModel(model: Model & { schemaVersion?: number }, fromVersion: number): Model {
  let migrated = model;
  if (fromVersion < 1) {
    // v0 → v1: stamp the schema version; the shape itself is unchanged.
    migrated = { ...model, schemaVersion: 1 };
  }
  return migrated;
}

function replacer(key: string, value: unknown): unknown {
  return key === 'raw' ? undefined : value;
}
