import { createSampleModel } from '@openarch/core';
import { describe, expect, it } from 'vitest';
import { GitRepository, type GitFileStore } from './git';

function memoryStore(): GitFileStore & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    async list() {
      return [...files.keys()];
    },
    async read(path) {
      const content = files.get(path);
      if (content === undefined) throw new Error(`No such file: ${path}`);
      return content;
    },
    async write(path, content) {
      files.set(path, content);
    },
    async remove(path) {
      files.delete(path);
    },
  };
}

describe('GitRepository over a file store', () => {
  it('round-trips models as JSON files with stable paths', async () => {
    const store = memoryStore();
    const repo = new GitRepository(store);
    const model = createSampleModel();
    await repo.saveModel(model);
    expect(store.files.has('models/sample-model.json')).toBe(true);

    const list = await repo.listModels();
    expect(list.map((summary) => summary.id)).toEqual(['sample-model']);
    const loaded = await repo.getModel('sample-model');
    expect(loaded?.elements.length).toBe(model.elements.length);
    expect(loaded?.relationships.length).toBe(model.relationships.length);

    await repo.deleteModel('sample-model');
    expect(await repo.listModels()).toEqual([]);
    expect(await repo.getModel('sample-model')).toBeUndefined();
  });
});
