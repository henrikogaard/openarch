import type { Model, SavedView, Waiver } from '@openarch/core';
import { type ModelRepository, summarize } from './types';

export interface ModelMeta {
  version: number;
  updatedAt: string;
  updatedBy: string;
  commentCount: number;
  snapshotCount: number;
}

/** Talks to the optional self-hosted server; same contract as LocalRepository. */
export class ServerRepository implements ModelRepository {
  constructor(private readonly baseUrl = 'http://localhost:8080/api') {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, init);
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        currentVersion?: number;
        current?: Model;
      };
      if (response.status === 409) {
        // Optimistic-locking conflict: expose the server's version and model
        // so the UI can offer a theirs-vs-yours review.
        const conflict = new Error(body.error ?? 'Conflict: workspace changed') as Error & {
          currentVersion?: number;
          current?: Model;
        };
        conflict.currentVersion = body.currentVersion;
        conflict.current = body.current;
        throw conflict;
      }
      throw new Error(body.error ?? `Server request failed: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as T;
  }

  async listModels() {
    const models = await this.request<Model[]>('/models');
    return models.map(summarize);
  }

  async getModel(id: string): Promise<Model | undefined> {
    const response = await fetch(`${this.baseUrl}/models/${encodeURIComponent(id)}`);
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`Server request failed: ${response.status}`);
    return (await response.json()) as Model;
  }

  getModelMeta(id: string): Promise<ModelMeta> {
    return this.request<ModelMeta>(`/models/${encodeURIComponent(id)}/meta`);
  }

  async saveModel(model: Model, expectedVersion?: number): Promise<void> {
    const version = expectedVersion ?? (await this.getModelMeta(model.id)).version;
    await this.request(`/models/${encodeURIComponent(model.id)}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'if-match': String(version),
      },
      body: JSON.stringify(model),
    });
  }

  async deleteModel(id: string): Promise<void> {
    await this.request(`/models/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  getDiff(id: string, compare?: string): Promise<unknown> {
    const suffix = compare ? `?compare=${encodeURIComponent(compare)}` : '';
    return this.request(`/models/${encodeURIComponent(id)}/diff${suffix}`);
  }

  listComments(id: string): Promise<unknown[]> {
    return this.request(`/models/${encodeURIComponent(id)}/comments`);
  }

  addComment(id: string, body: string, elementId?: string): Promise<unknown> {
    return this.request(`/models/${encodeURIComponent(id)}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body, elementId }),
    });
  }

  listAudit(id: string): Promise<unknown[]> {
    return this.request(`/models/${encodeURIComponent(id)}/audit`);
  }

  listSnapshots(id: string): Promise<unknown[]> {
    return this.request(`/models/${encodeURIComponent(id)}/snapshots`);
  }

  listSavedViews(id: string): Promise<SavedView[]> {
    return this.request(`/models/${encodeURIComponent(id)}/saved-views`);
  }

  saveSavedView(view: SavedView): Promise<SavedView> {
    return this.request(`/models/${encodeURIComponent(view.modelId)}/saved-views`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(view),
    });
  }

  deleteSavedView(modelId: string, viewId: string): Promise<void> {
    return this.request(`/models/${encodeURIComponent(modelId)}/saved-views/${encodeURIComponent(viewId)}`, {
      method: 'DELETE',
    });
  }

  createSnapshot(id: string, label?: string): Promise<unknown> {
    return this.request(`/models/${encodeURIComponent(id)}/snapshots`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label }),
    });
  }

  async getSnapshot(id: string, snapshotId: string): Promise<Model> {
    const snapshot = await this.request<{ model: Model }>(
      `/models/${encodeURIComponent(id)}/snapshots/${encodeURIComponent(snapshotId)}`,
    );
    return snapshot.model;
  }

  restoreSnapshot(id: string, snapshotId: string): Promise<Model> {
    return this.request(
      `/models/${encodeURIComponent(id)}/snapshots/${encodeURIComponent(snapshotId)}/restore`,
      { method: 'POST' },
    ) as Promise<Model>;
  }

  listApprovals(id: string): Promise<unknown[]> {
    return this.request(`/models/${encodeURIComponent(id)}/approvals`);
  }

  recordApproval(
    id: string,
    baselineId: string,
    decision: 'approved' | 'rejected',
    comment?: string,
  ): Promise<unknown> {
    return this.request(`/models/${encodeURIComponent(id)}/approvals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baselineId, decision, comment }),
    });
  }

  listWaivers(id: string): Promise<Waiver[]> {
    return this.request(`/models/${encodeURIComponent(id)}/waivers`);
  }

  addWaiver(id: string, waiver: { rule: string; entityId?: string; reason: string }): Promise<Waiver> {
    return this.request(`/models/${encodeURIComponent(id)}/waivers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(waiver),
    });
  }

  deleteWaiver(id: string, waiverId: string): Promise<void> {
    return this.request(`/models/${encodeURIComponent(id)}/waivers/${encodeURIComponent(waiverId)}`, {
      method: 'DELETE',
    });
  }
}
