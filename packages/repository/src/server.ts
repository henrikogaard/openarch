import type { GroupRole, Model, ModelSummary, SavedView, Waiver, WorkspaceMember } from '@openarch/core';
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
    const response = await fetch(`${this.baseUrl}${path}`, {
      signal: AbortSignal.timeout(15000),
      ...init,
    });
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
    // The server exposes paginated summaries (?summary=1) so the home
    // screen never downloads every full workspace model. Fall back to the
    // full-array route for older servers.
    try {
      const { items, nextCursor } = await this.request<{ items: ModelSummary[]; nextCursor?: string }>(
        '/models?summary=1&limit=200',
      );
      const page = Array.isArray(items) ? items : [];
      // Cursor pagination: fetch the next pages while a cursor is offered.
      let cursor = nextCursor;
      let guard = 0;
      while (cursor && guard < 20) {
        const next = await this.request<{ items: ModelSummary[]; nextCursor?: string }>(
          `/models?summary=1&limit=200&cursor=${encodeURIComponent(cursor)}`,
        );
        page.push(...(Array.isArray(next.items) ? next.items : []));
        cursor = next.nextCursor;
        guard += 1;
      }
      return page;
    } catch {
      const models = await this.request<Model[]>('/models');
      return models.map(summarize);
    }
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
    const encoded = encodeURIComponent(model.id);
    if (expectedVersion === undefined) {
      // No version on hand: this is either a brand-new workspace (POST) or a
      // client whose meta fetch failed. Refuse to blind-write in the update
      // case (that is exactly the stale-client scenario If-Match exists to
      // block); create via POST when the workspace does not exist yet.
      let meta: (ModelMeta & { updatedAt?: string }) | undefined;
      try {
        meta = await this.request<ModelMeta>(`/models/${encoded}/meta`);
      } catch {
        meta = undefined;
      }
      if (meta) {
        const savedAt = Date.parse(model.updatedAt ?? '');
        const serverAt = Date.parse(meta.updatedAt);
        // If the server's copy is newer than ours and we had a stamp, someone
        // else wrote in between — surface the conflict instead of clobbering.
        if (!Number.isNaN(savedAt) && !Number.isNaN(serverAt) && serverAt > savedAt) {
          throw Object.assign(new Error('Conflict: workspace changed'), {
            currentVersion: meta.version,
          });
        }
        return this.putModel(model, meta.version);
      }
      // Not on the server yet — create.
      await this.request('/models', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(model),
      });
      return;
    }
    await this.putModel(model, expectedVersion);
  }

  private async putModel(model: Model, version: number): Promise<void> {
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

  getMembers(id: string): Promise<{ members: WorkspaceMember[]; groupRoles: GroupRole[] }> {
    return this.request(`/models/${encodeURIComponent(id)}/members`);
  }

  saveMembers(
    id: string,
    members: WorkspaceMember[],
    groupRoles: GroupRole[],
  ): Promise<{ members: WorkspaceMember[]; groupRoles: GroupRole[] }> {
    return this.request(`/models/${encodeURIComponent(id)}/members`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ members, groupRoles }),
    });
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

  setOrg(id: string, orgId: string | null): Promise<unknown> {
    return this.request(`/models/${encodeURIComponent(id)}/org`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgId }),
    });
  }
}
