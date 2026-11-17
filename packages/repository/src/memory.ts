import type { Model } from '@openarch/core';
import { type ModelRepository, summarize } from './types';

/** Used by the server (with file persistence) and by tests. */
export class MemoryRepository implements ModelRepository {
  private readonly models = new Map<string, Model>();
  private readonly watchers = new Map<string, Set<(model: Model) => void>>();

  constructor(models: Model[] = []) {
    for (const model of models) this.models.set(model.id, model);
  }

  async listModels() {
    return [...this.models.values()].map(summarize);
  }

  async getModel(id: string): Promise<Model | undefined> {
    return this.models.get(id);
  }

  allModels(): Model[] {
    return [...this.models.values()];
  }

  async saveModel(model: Model, expectedVersion?: number): Promise<void> {
    void expectedVersion;
    const stamped = { ...model, updatedAt: new Date().toISOString() };
    this.models.set(model.id, stamped);
    for (const callback of this.watchers.get(model.id) ?? []) callback(stamped);
  }

  async deleteModel(id: string): Promise<void> {
    this.models.delete(id);
  }

  watch(id: string, callback: (model: Model) => void): () => void {
    const callbacks = this.watchers.get(id) ?? new Set();
    callbacks.add(callback);
    this.watchers.set(id, callbacks);
    return () => callbacks.delete(callback);
  }
}
