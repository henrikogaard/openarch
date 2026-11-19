import { parseAoef, type Model } from '@openarch/core';
import { type ModelRepository, summarize } from './types';
import { parseNativeModel, serializeNativeModel } from './local';

export interface GitFileStore {
  list(): Promise<string[]>;
  read(path: string): Promise<string>;
  write(path: string, content: string, message: string): Promise<void>;
  remove?(path: string, message: string): Promise<void>;
}

/** Stores each model as a human-readable JSON file in a Git-backed file store. */
export class GitRepository implements ModelRepository {
  constructor(
    private readonly store: GitFileStore,
    private readonly directory = 'models',
  ) {}

  private path(id: string): string {
    return `${this.directory}/${id.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`;
  }

  async listModels() {
    const files = await this.store.list();
    const models = await Promise.all(
      files
        .filter((file) => file.startsWith(`${this.directory}/`) && file.endsWith('.json'))
        .map(async (file) => parseNativeModel(await this.store.read(file))),
    );
    return models.map(summarize);
  }

  async getModel(id: string): Promise<Model | undefined> {
    try {
      return parseNativeModel(await this.store.read(this.path(id)));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Only genuine absence maps to "no such model" — auth, rate limits, and
      // network errors must surface, or callers "recover" by creating over
      // the real file.
      if (/GitHub (list|read) failed: 404/.test(message) || /No such file/.test(message) || message.includes('no content')) {
        return undefined;
      }
      throw error;
    }
  }

  async saveModel(model: Model, expectedVersion?: number): Promise<void> {
    void expectedVersion;
    await this.store.write(this.path(model.id), serializeNativeModel(model), `Update model ${model.id}`);
  }

  async deleteModel(id: string): Promise<void> {
    if (!this.store.remove) throw new Error('Git file store does not support deletions');
    await this.store.remove(this.path(id), `Delete model ${id}`);
  }
}

/** Minimal GitHub Contents API adapter — no external dependencies. */
export function createGitHubFileStore(options: {
  token: string;
  owner: string;
  repo: string;
  branch?: string;
  root?: string;
}): GitFileStore {
  const branch = options.branch ?? 'main';
  const root = options.root ?? '';
  const base = `https://api.github.com/repos/${options.owner}/${options.repo}/contents`;
  const headers = {
    Authorization: `Bearer ${options.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const fullPath = (path: string) => (root ? `${root}/${path}` : path);
  const timeout = () => AbortSignal.timeout(20000);
  const encodedBranch = encodeURIComponent(branch);

  async function readSha(path: string): Promise<string | undefined> {
    const response = await fetch(`${base}/${encodeURI(fullPath(path))}?ref=${encodedBranch}`, {
      headers,
      signal: timeout(),
    });
    // Only a genuine "file does not exist" means absent; rate limits and
    // server errors must surface, or a sha-less PUT turns them into opaque
    // GitHub 422s downstream.
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`GitHub read failed: ${response.status}`);
    const data = (await response.json()) as { sha?: string };
    return data.sha;
  }

  return {
    async list() {
      const response = await fetch(`${base}/${root ? `${root}?ref=` : `?ref=`}${encodedBranch}`, {
        headers,
        signal: timeout(),
      });
      if (!response.ok) throw new Error(`GitHub list failed: ${response.status}`);
      const entries = (await response.json()) as Array<{ name: string; type: string }>;
      return entries.filter((entry) => entry.type === 'file').map((entry) => `${root ? `${root}/` : ''}${entry.name}`);
    },
    async read(path) {
      const response = await fetch(`${base}/${encodeURI(fullPath(path))}?ref=${encodedBranch}`, {
        headers,
        signal: timeout(),
      });
      if (!response.ok) throw new Error(`GitHub read failed: ${response.status}`);
      const data = (await response.json()) as { content?: string };
      if (!data.content) throw new Error('GitHub file has no content');
      const cleaned = data.content.replace(/\s/g, '');
      if (typeof Buffer !== 'undefined') return Buffer.from(cleaned, 'base64').toString('utf-8');
      return decodeURIComponent(escape(atob(cleaned)));
    },
    async write(path, content, message) {
      const sha = await readSha(path);
      const body = {
        message,
        content: typeof Buffer !== 'undefined' ? Buffer.from(content, 'utf-8').toString('base64') : btoa(unescape(encodeURIComponent(content))),
        branch,
        ...(sha ? { sha } : {}),
      };
      const response = await fetch(`${base}/${encodeURI(fullPath(path))}`, {
        method: 'PUT',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: timeout(),
      });
      if (!response.ok) throw new Error(`GitHub write failed: ${response.status}`);
    },
    async remove(path, message) {
      const sha = await readSha(path);
      if (!sha) return;
      const response = await fetch(`${base}/${encodeURI(fullPath(path))}`, {
        method: 'DELETE',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ message, sha, branch }),
        signal: timeout(),
      });
      if (!response.ok) throw new Error(`GitHub delete failed: ${response.status}`);
    },
  };
}

/** Convenience: parse an AOEF string through the same pipeline used by imports. */
export function modelFromAoef(xml: string): Model {
  return parseAoef(xml);
}
