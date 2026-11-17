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
export function serializeNativeModel(model: Model): string {
  return `${JSON.stringify(model, replacer, 2)}\n`;
}

export function parseNativeModel(json: string): Model {
  const model = JSON.parse(json) as Model;
  if (!model || typeof model.id !== 'string' || !Array.isArray(model.elements)) {
    throw new Error('Not an OpenArch native model file');
  }
  return model;
}

function replacer(key: string, value: unknown): unknown {
  return key === 'raw' ? undefined : value;
}
