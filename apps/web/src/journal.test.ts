import 'fake-indexeddb/auto';
import { createSampleModel } from '@openarch/core';
import { afterEach, describe, expect, it } from 'vitest';
import { journalClear, journalRead, journalWrite } from './journal';

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
  // Two microtask rounds settle idb-keyval promises deterministically.
  await new Promise((resolve) => setTimeout(resolve, 10));
}

describe('crash journal', () => {
  afterEach(() => {
    journalWrite.last.clear();
    journalWrite.timer.forEach((timer) => window.clearTimeout(timer));
    journalWrite.timer.clear();
  });

  it('writes snapshots and reads back work newer than the saved state', async () => {
    const sample = createSampleModel();
    journalWrite(sample, () => JSON.stringify(sample));
    await flush();

    const entry = await journalRead(sample.id, sample.updatedAt ?? null);
    expect(entry).toBeTruthy();
    expect(typeof entry!.stamped).toBe('string');

    // A save NEWER than the journal stamp suppresses recovery.
    const after = new Date(Date.now() + 10_000).toISOString();
    const entry2 = await journalRead(sample.id, after);
    expect(entry2).toBeUndefined();

    journalClear(sample.id);
    await flush();
    expect(await journalRead(sample.id, null)).toBeUndefined();
  });
});
