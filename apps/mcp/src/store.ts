import { createSampleModel, parseAoef, type Model, type ModelSummary } from '@openarch/core';
import { MemoryRepository, parseNativeModel, summarize } from '@openarch/repository';
import { readFileSync } from 'node:fs';

/** Storage contract used by every MCP tool. Implementations may be local or remote. */
export interface ModelStore {
  listModels(): Promise<ModelSummary[]>;
  getModel(id: string): Promise<Model | undefined>;
  saveModel(model: Model): Promise<void>;
  deleteModel?(id: string): Promise<void>;
  getModelMeta?(id: string): Promise<Record<string, unknown>>;
}

/** In-memory store seeded with the built-in sample model. */
export class MemoryModelStore implements ModelStore {
  private readonly repository: MemoryRepository;

  constructor(models: Model[] = [createSampleModel()]) {
    this.repository = new MemoryRepository(models);
  }

  listModels(): Promise<ModelSummary[]> {
    return this.repository.listModels();
  }

  getModel(id: string): Promise<Model | undefined> {
    return this.repository.getModel(id);
  }

  saveModel(model: Model): Promise<void> {
    return this.repository.saveModel(model);
  }

  deleteModel(id: string): Promise<void> {
    return this.repository.deleteModel(id);
  }
}

/**
 * Store backed by the optional OpenArch server. Talks to the same REST API as
 * the web app, so agents and humans see identical data in server mode.
 */
export class HttpModelStore implements ModelStore {
  private readonly baseUrl: string;
  private readonly token?: string;

  constructor(baseUrl?: string, token?: string) {
    this.baseUrl = (baseUrl ?? process.env.OPENARCH_API_URL ?? 'http://localhost:8080/api').replace(/\/$/, '');
    // Required when the server runs with OPENARCH_REQUIRE_AUTH=true.
    this.token = token ?? process.env.OPENARCH_TOKEN;
  }

  /** Headers shared by every request, including the bearer token when set. */
  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      ...extra,
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
    };
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: this.headers((init?.headers as Record<string, string>) ?? {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Could not reach the OpenArch server at ${this.baseUrl} (OPENARCH_API_URL); ` +
          `check that it is running and that OPENARCH_API_URL is correct. Cause: ${message}`,
      );
    }
    if (!response.ok) {
      let detail = '';
      try {
        const body = (await response.json()) as { error?: string };
        detail = body.error ?? '';
      } catch {
        // The error body was not JSON; the status line is still useful.
      }
      throw new Error(
        `OpenArch server (OPENARCH_API_URL=${this.baseUrl}) returned ${response.status} ${response.statusText}${detail ? `: ${detail}` : ''}`,
      );
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  async listModels(): Promise<ModelSummary[]> {
    const models = await this.request<Model[]>('/models');
    return models.map(summarize);
  }

  async getModel(id: string): Promise<Model | undefined> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/models/${encodeURIComponent(id)}`, {
        headers: this.headers(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Could not reach the OpenArch server at ${this.baseUrl} (OPENARCH_API_URL). Cause: ${message}`,
      );
    }
    if (response.status === 404) return undefined;
    if (!response.ok) {
      throw new Error(`OpenArch server (OPENARCH_API_URL=${this.baseUrl}) returned ${response.status}`);
    }
    return (await response.json()) as Model;
  }

  async saveModel(model: Model): Promise<void> {
    // Optimistic locking: fetch the current version first and send If-Match.
    // A blind last-writer-wins PUT silently reverts concurrent human edits
    // (the web app autosaves on a timer, so this is a realistic collision).
    let expectedVersion: number | undefined;
    try {
      const meta = await this.request<{ version: number }>(
        `/models/${encodeURIComponent(model.id)}/meta`,
      );
      expectedVersion = meta?.version;
    } catch {
      expectedVersion = undefined; // may not exist yet — POST path below
    }
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/models/${encodeURIComponent(model.id)}`, {
        method: 'PUT',
        headers: this.headers({
          'content-type': 'application/json',
          ...(expectedVersion !== undefined ? { 'if-match': String(expectedVersion) } : {}),
        }),
        body: JSON.stringify(model),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Could not reach the OpenArch server at ${this.baseUrl} (OPENARCH_API_URL). Cause: ${message}`,
      );
    }
    if (response.status === 404) {
      // The server creates new workspaces through POST /models.
      await this.request('/models', {
        method: 'POST',
        headers: this.headers({ 'content-type': 'application/json' }),
        body: JSON.stringify(model),
      });
      return;
    }
    if (!response.ok) {
      let detail = '';
      try {
        detail = ((await response.json()) as { error?: string }).error ?? '';
      } catch {
        // Non-JSON error body; the status is enough.
      }
      throw new Error(
        `OpenArch server (OPENARCH_API_URL=${this.baseUrl}) returned ${response.status} ${response.statusText}${detail ? `: ${detail}` : ''}`,
      );
    }
  }

  async deleteModel(id: string): Promise<void> {
    await this.request(`/models/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: this.headers(),
    });
  }

  async getModelMeta(id: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(`/models/${encodeURIComponent(id)}/meta`);
  }
}

/** Select the backend from the environment: HTTP server, model file, or sample. */
export function createModelStore(): ModelStore {
  const apiUrl = process.env.OPENARCH_API_URL;
  if (apiUrl) {
    return new HttpModelStore(apiUrl);
  }

  const modelFile = process.env.OPENARCH_MODEL_FILE;
  if (modelFile) {
    try {
      const contents = readFileSync(modelFile, 'utf-8');
      const model: Model = modelFile.toLowerCase().endsWith('.json')
        ? parseNativeModel(contents)
        : parseAoef(contents);
      process.stderr.write(
        `${JSON.stringify({ ts: new Date().toISOString(), event: 'store.loaded', source: modelFile, modelId: model.id })}\n`,
      );
      return new MemoryModelStore([model]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not load OPENARCH_MODEL_FILE (${modelFile}): ${message}`);
    }
  }

  return new MemoryModelStore();
}
