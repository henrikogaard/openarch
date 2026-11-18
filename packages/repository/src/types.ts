import type { Model, ModelSummary, SavedView, Waiver } from '@openarch/core';
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
  /** Server-mode governance: approvals and check waivers. */
  listApprovals?(modelId: string): Promise<unknown[]>;
  recordApproval?(modelId: string, baselineId: string, decision: 'approved' | 'rejected', comment?: string): Promise<unknown>;
  listWaivers?(modelId: string): Promise<Waiver[]>;
  addWaiver?(modelId: string, waiver: { rule: string; entityId?: string; reason: string }): Promise<Waiver>;
  deleteWaiver?(modelId: string, waiverId: string): Promise<void>;
}

export function summarize(model: Model): ModelSummary {
  return workspaceSummary(model);
}
