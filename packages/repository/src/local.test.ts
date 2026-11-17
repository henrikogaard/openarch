import 'fake-indexeddb/auto';
import { createSampleModel } from '@openarch/core';
import { describe, expect, it } from 'vitest';
import {
  LocalRepository,
  parseNativeModel,
  serializeNativeModel,
} from './local';
import { MemoryRepository } from './memory';
import { summarize } from './types';

describe('LocalRepository', () => {
  it('saves, lists, and deletes models', async () => {
    const repository = new LocalRepository();
    const model = createSampleModel();
    await repository.saveModel(model);

    const [summary] = await repository.listModels();
    expect(summary).toEqual({ ...summarize(model), updatedAt: expect.any(String) });
    expect((await repository.getModel(model.id))?.elements).toHaveLength(model.elements.length);

    await repository.deleteModel(model.id);
    expect(await repository.listModels()).toEqual([]);
  });
});

describe('MemoryRepository', () => {
  it('notifies watchers on save', async () => {
    const repository = new MemoryRepository();
    const model = createSampleModel();
    let notified: string | undefined;
    const stop = repository.watch(model.id, (updated) => {
      notified = updated.id;
    });
    await repository.saveModel(model);
    expect(notified).toBe(model.id);
    stop();
  });
});

describe('native model format', () => {
  it('round-trips without XML passthrough data', () => {
    const model = createSampleModel();
    const json = serializeNativeModel(model);
    expect(json).not.toContain('"raw"');
    expect(parseNativeModel(json).elements).toHaveLength(model.elements.length);
  });
});
