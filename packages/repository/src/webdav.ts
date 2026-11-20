import type { Model, ModelSummary, SavedView } from '@openarch/core';
import { parseNativeModel, serializeNativeModel } from './local';
import { type ModelRepository, summarize } from './types';

/**
 * WebDAV repository (spec §9.1, wave-3 item 4). Reads/writes the same
 * native-JSON files as FolderRepository but over HTTP DAV (Nextcloud,
 * Syncthing+DAV, any WebDAV server). CORS note: the server's
 * Access-Control-Allow-Origin must include the app's origin (documented in
 * docs/deployment.md § tier 3).
 *
 * Concurrency follows the §9.1 rule: a synced share with one writer at a
 * time is supported; WebDAV provides neither locks nor events — an external
 * newer updatedAt surfaces as FolderDriftError-like WebDavDriftError, and
 * this repository always rejects (the app escalates to ConflictReview).
 */
export class WebDavDriftError extends Error {
  constructor(
    public readonly incomingModel: Model,
  ) {
    super('The WebDAV copy changed outside this session — review before saving');
  }
}

export class WebDavRepository implements ModelRepository {
  constructor(
    private readonly base: string,
    private readonly onDrift?: (error: WebDavDriftError) => 'overwrite' | 'reject',
  ) {}

  private url(path: string): string {
    const trimmed = this.base.replace(/\/+$/, '');
    return `${trimmed}/${path.replace(/^\/+/, '')}`;
  }

  private fileName(id: string): string {
    return `models-${id.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`;
  }

  private async davRequest(
    method: string,
    url: string,
    body?: string,
  ): Promise<{ ok: boolean; status: number; text: string }> {
    const response = await fetch(url, {
      method,
      ...this.additionalOptions(method, body),
    });
    const text = await response.text().catch(() => '');
    return { ok: response.ok, status: response.status, text };
  }

  private additionalOptions(method: string, body?: string): RequestInit {
    return {
      headers: { 'content-type': 'application/json', ...(method === 'PUT' ? { 'if-match': '*' } : {}) },
      ...(body !== undefined ? { body } : {}),
      signal: AbortSignal.timeout(20000),
    };
  }

  async listModels(): Promise<ModelSummary[]> {
    const result = await this.davRequest('PROPFIND', this.url('models/'), undefined);
    if (!result.ok) {
      throw new Error(`WebDAV listing failed: ${result.status}`);
    }
    const summaries: ModelSummary[] = [];
    // DAV responses carry hrefs as paths ('/dir/models-x.json'), sometimes as absolute URLs.
    const hrefRegex = /<(?:[a-zA-Z0-9-]+:)?href[^>]*>\s*([^<]*models-[^<\s]+\.json)\s*</g;
    const files = [...result.text.matchAll(hrefRegex)]
      .map((match) => match[1].trim())
      .filter((href, index, all) => all.indexOf(href) === index);
    for (const name of files.map((href) => href.split('/').pop()!)) {
      try {
        const fileResult = await this.davRequest('GET', this.url(name));
        summaries.push(summarize(parseNativeModel(fileResult.text)));
      } catch {
        // Unreadable file — list skips (crash-artefacts do not block UI).
      }
    }
    return summaries;
  }

  async getModel(id: string): Promise<Model | undefined> {
    const result = await this.davRequest('GET', this.url(this.fileName(id)));
    if (!result.ok) return undefined;
    return parseNativeModel(result.text);
  }

  async saveModel(model: Model, expectedVersion?: number): Promise<void> {
    void expectedVersion; // DAV has no version headers uniformly; drift handles it
    const url = this.url(this.fileName(model.id));
    // Drift: read the existing copy; reject if the remote stamp is newer than ours.
    let incoming: Model | undefined;
    const existing = await this.davRequest('GET', url);
    if (existing.ok) {
      try {
        incoming = parseNativeModel(existing.text);
      } catch {
        const response = await this.davRequest('DELETE', url);
        if (!response.ok) throw new Error(`WebDAV cleanup failed: ${response.status}`);
        incoming = undefined;
      }
    }
    if (incoming && incoming.updatedAt && model.updatedAt && Date.parse(incoming.updatedAt) > Date.parse(model.updatedAt)) {
      const drift = new WebDavDriftError(incoming);
      if (this.onDrift?.(drift) !== 'overwrite') {
        throw drift;
      }
    }
    const result = await this.davRequest('PUT', url, serializeNativeModel(model));
    if (!result.ok) throw new Error(`WebDAV write failed: ${result.status}`);
  }

  async deleteModel(id: string): Promise<void> {
    const result = await this.davRequest('DELETE', this.url(this.fileName(id)));
    if (!result.ok) throw new Error(`WebDAV delete failed: ${result.status}`);
  }

  async listSavedViews(modelId: string): Promise<SavedView[]> {
    void modelId;
    return [];
  }
}
