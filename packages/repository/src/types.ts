import type { Model, ModelSummary, SavedView } from '@openarch/core';
import { workspaceSummary } from '@openarch/core';

/**
 * The single storage contract used by the editor, catalog, and dashboard.
 * Local (IndexedDB), server (REST), and Git adapters implement the same API.
 */
export interface ModelRepository {
  listModels(): Promise<ModelSummary[]>;
  getModel(id: string): Promise<Model | undefined>;
  /**
   * Persist a model. Adapters that support optimistic locking accept the
   * version the client loaded and reject the write when it is stale.
   */
  saveModel(model: Model, expectedVersion?: number): Promise<void>;
  deleteModel(id: string): Promise<void>;
  watch?(id: string, callback: (model: Model) => void): () => void;
  listSavedViews?(modelId: string): Promise<SavedView[]>;
  saveSavedView?(view: SavedView): Promise<SavedView>;
  deleteSavedView?(modelId: string, viewId: string): Promise<void>;
  /** Server-mode version history (snapshots). Undefined in local mode. */
  listSnapshots?(modelId: string): Promise<unknown[]>;
  getSnapshot?(modelId: string, snapshotId: string): Promise<Model>;
  restoreSnapshot?(modelId: string, snapshotId: string): Promise<Model>;
  createSnapshot?(modelId: string, label?: string): Promise<unknown>;
}

export function summarize(model: Model): ModelSummary {
  return workspaceSummary(model);
}
