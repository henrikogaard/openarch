import 'fake-indexeddb/auto';
import { createSampleModel } from '@openarch/core';
import { describe, expect, it } from 'vitest';
import {
  LocalRepository,
  NATIVE_SCHEMA_VERSION,
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

describe('native schema migration', () => {
  it('stamps schemaVersion on serialize and migrates v0 files on parse', () => {
    const model = createSampleModel();
    const serialized = serializeNativeModel(model);
    expect(JSON.parse(serialized).schemaVersion).toBe(NATIVE_SCHEMA_VERSION);

    // A v0 file (no schemaVersion) parses and is stamped v1.
    const legacy = JSON.parse(serialized);
    delete legacy.schemaVersion;
    const migrated = parseNativeModel(JSON.stringify(legacy));
    expect(migrated.schemaVersion).toBe(1);
    expect(migrated.elements.length).toBe(model.elements.length);

    // Newer schemas are rejected, not silently misread.
    const future = { ...JSON.parse(serialized), schemaVersion: 99 };
    expect(() => parseNativeModel(JSON.stringify(future))).toThrow(/newer than this app supports/);
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
