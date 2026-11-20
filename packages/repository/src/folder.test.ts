import { createSampleModel } from '@openarch/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FolderRepository, type FileSystemDirectoryHandle, type FileSystemFileHandleLike } from './folder';

/**
 * B1 adapter contract test with a fake directory handle: save/list/get/
 * reattach round-trip, drift rejection (typed error, never silent), adopt
 * from a second machine (dates newer), and archive-not-delete semantics.
 */

function fakeDir(files: Map<string, string>): FileSystemDirectoryHandle {
  // The SAME Map (no copies) so writes are observable by the test.
  const handles = files;
  return {
    kind: 'directory',
    name: 'fake',
    async getFileHandle(name: string, options?: { create?: boolean }) {
      if (!handles.has(name)) {
        if (options?.create === true) {
          handles.set(name, '');
          return {
            kind: 'file',
            name,
            createWritable: async () => ({
              async write(data: string) {
                handles.set(name, data);
              },
              async close() {},
            }),
            getFile: () => {
              throw new Error('empty file');
            },
          } as FileSystemFileHandleLike;
        }
        throw new Error(`NotFound: ${name}`);
      }
      const entry = handles.get(name)!;
      if (!entry && options?.create === true) {
        throw new Error('empty file');
      }
      return {
        kind: 'file',
        name,
        createWritable: async () => ({
          async write(data: string) {
            handles.set(name, data);
          },
          async close() {},
        }),
        getFile: () => {
          if (!entry) throw new Error('empty file');
          return { lastModified: 0, text: async () => entry };
        },
      } as FileSystemFileHandleLike;
    },
    // Minimal AsyncIterable: only files (our listModels consumes kind === 'file').
    async *values(): AsyncIterableIterator<{ kind: 'file' | 'directory'; name: string }> {
      for (const name of files.keys()) {
        yield { kind: 'file', name };
      }
    },
  } as unknown as FileSystemDirectoryHandle;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FolderRepository (B1)', () => {
  it('save → list → get round-trips through the folder (native JSON on disk)', async () => {
    const files = new Map<string, string>();
    const dir = fakeDir(files);
    const repository = await FolderRepository.adopt(dir);
    const model = createSampleModel();

    await repository.saveModel(model);
    // The file sits in the folder under the models- naming.
    const name = [...files.keys()].find((entry) => entry.startsWith('models-') && entry.endsWith('.json'));
    expect(name).toBeTruthy();

    const list = await repository.listModels();
    expect(list.some((summary) => summary.id === model.id)).toBe(true);

    const read2 = await repository.getModel(model.id);
    expect(read2?.elements.length).toBe(model.elements.length);
    // Reattach later: a fresh repository over the same folder finds it.
    const reattached = await FolderRepository.adopt(fakeDir(new Map(files)));
    expect(await reattached.getModel(model.id)).toBeTruthy();
  });

  it('drift: the file changing newer than our save baseline rises as FolderDriftError, never silent', async () => {
    const files = new Map<string, string>();
    const dir = fakeDir(files);
    const repository = await FolderRepository.adopt(dir, () => 'reject');
    const model = createSampleModel();
    model.updatedAt = '2026-01-01T00:00:00Z';
    await repository.saveModel(model);

    // Another machine writes the same file with a NEWER stamp,
    // while our in-memory model.stamp stays the old one.
    const repo2 = await FolderRepository.adopt(fakeDir(new Map(files)));
    const fresh = await repo2.getModel(model.id);
    expect(fresh).toBeTruthy();
    const newer = { ...(fresh as object), updatedAt: '2027-01-01T00:00:00Z' } as typeof model;
    await repo2.saveModel(newer);

    // Our stale save hits the drift rule when the on-file stamp is newer
    // than what our model declares.
    const drifting = structuredClone(model);
    await expect(repository.saveModel(drifting)).rejects.toThrow(
      /file changed outside this session/i,
    );
  });

  it('deletion is archive-status / manage-files-directly, not a file remove', async () => {
    const repository = await FolderRepository.adopt(fakeDir(new Map()));
    await expect(repository.deleteModel('x')).rejects.toThrow(/archive status/i);
  });
});
