import type { Model, ModelSummary, SavedView } from '@openarch/core';
import { createStore, del, get, keys, set } from 'idb-keyval';
import { type ModelRepository, summarize } from './types';

const modelStore = createStore('openarch', 'models');
const savedViewStore = createStore('openarch', 'saved-views');
// Separate database: adding a store to an existing IDB database after
// first creation is version-fragile across environments; a standalone DB
// keeps the index self-contained and cheap.
const summaryStore = createStore('openarch-summaries', 'summaries');

/** Default adapter: models live in the browser, no account and no server. */
export class LocalRepository implements ModelRepository {
  async listModels() {
    // Summaries are indexed at save time so listing never deserializes every
    // full model (the home screen previously read all workspaces wholesale).
    const ids = (await keys(summaryStore)).filter((id): id is string => typeof id === 'string');
    const summaries = await Promise.all(ids.map((id) => get<ModelSummary>(id, summaryStore)));
    const found = summaries.filter((summary): summary is ModelSummary => Boolean(summary));
    if (found.length === 0) {
      // First run after this upgrade, or legacy data without an index: build it once.
      const modelIds = (await keys(modelStore)).filter((id): id is string => typeof id === 'string');
      if (modelIds.length === 0) return [];
      const models = await Promise.all(modelIds.map((id) => get<Model>(id, modelStore)));
      const rebuilt = await Promise.all(
        models
          .filter((model): model is Model => Boolean(model))
          .map(async (model) => {
            const summary = summarize(model);
            await set(model.id, summary, summaryStore);
            return summary;
          }),
      );
      return rebuilt;
    }
    return found;
  }

  getModel(id: string): Promise<Model | undefined> {
    return get<Model>(id, modelStore);
  }

  async saveModel(model: Model, expectedVersion?: number): Promise<void> {
    void expectedVersion;
    // Stamp the save time so the workspace list can show recency.
    const stamped = { ...model, updatedAt: new Date().toISOString() };
    await set(model.id, stamped, modelStore);
    // Keep the summary index in sync for cheap listing.
    await set(model.id, summarize(stamped), summaryStore);
  }

  async deleteModel(id: string): Promise<void> {
    await del(id, modelStore);
    await del(id, summaryStore);
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
  const invalid =
    !parsed ||
    typeof parsed !== 'object' ||
    typeof parsed.id !== 'string' ||
    !Array.isArray(parsed.elements) ||
    !Array.isArray(parsed.relationships) ||
    !Array.isArray(parsed.views) ||
    !Array.isArray(parsed.name) ||
    !Array.isArray(parsed.propertyDefinitions);
  if (invalid) {
    throw new Error(
      'Not an OpenArch native model file (expected id, name, propertyDefinitions, elements, relationships, views arrays)',
    );
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
