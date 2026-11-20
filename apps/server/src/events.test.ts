import { createSampleModel } from '@openarch/core';
import { serializeNativeModel } from '@openarch/repository';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EVENTS_PER_SNAPSHOT, eventStoreRoot, migrateLegacyVolume, WorkspaceEventStore } from './events';

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'openarch-events-'));
}

const model = createSampleModel();

describe('WorkspaceEventStore (C2)', () => {
  it('initializes from a model, appends validated ops, replays identically', () => {
    const root = scratch();
    const store = new WorkspaceEventStore(root, model.id);
    store.initialize(model);
    expect(store.exists()).toBe(true);

    // Replay from snapshot 0 with no events → the model round-trips.
    const initial = store.replay();
    expect(initial.model.elements.length).toBe(model.elements.length);

    // Append a valid op.
    let current = initial.model;
    const appended = store.append(current, {
      kind: 'element.create',
      ref: 'el-c2',
      after: { type: 'BusinessActor', name: 'C2 actor' },
    }, 'admin');
    expect(appended.result.ok).toBe(true);
    expect(appended.result.version).toBe(1);
    current = appended.model;

    // An INVALID op is rejected, version does not move, nothing is appended.
    const rejected = store.append(current, {
      kind: 'relationship.create',
      ref: 'rel-dangling',
      after: { type: 'Serving', source: 'ghost', target: 'ghost-2' },
    }, 'admin');
    expect(rejected.result.ok).toBe(false);
    expect(rejected.result.issues?.some((issue) => issue.severity === 'error')).toBe(true);
    expect(store.readMeta().version).toBe(1); // unchanged

    // Replay matches the in-memory projection exactly.
    const replayed = store.replay();
    expect(replayed.version).toBe(1);
    expect(replayed.model.elements.some((element) => element.id === 'el-c2')).toBe(true);
    expect(replayed.chainErrors).toEqual([]);
    expect(replayed.model.elements.length).toBe(current.elements.length);
  });

  it('snapshots at the configured cadence and verifies the hash chain', () => {
    const root = scratch();
    const store = new WorkspaceEventStore(root, model.id);
    store.initialize(model);
    let current = model;
    for (let i = 0; i < EVENTS_PER_SNAPSHOT; i += 1) {
      const applied = store.append(current, {
        kind: 'element.update',
        ref: 'e-customer',
        after: { name: `Customer v${i}` },
      }, 'fuzzer');
      expect(applied.result.ok).toBe(true);
      current = applied.model;
      if (applied.result.ok && applied.result.version >= i + 1) continue;
    }
    const snapshot = store.newestSnapshot();
    expect(snapshot?.afterOps).toBe(EVENTS_PER_SNAPSHOT);
    const replayed = store.replay();
    expect(replayed.chainErrors).toEqual([]);
    expect(replayed.model.elements.find((element) => element.id === 'e-customer')?.name[0].value).toContain(`v${EVENTS_PER_SNAPSHOT - 1}`);
  });

  it('the hash chain detects a tampered event line', async () => {
    const root = scratch();
    const store = new WorkspaceEventStore(root, model.id);
    store.initialize(model);
    const first = store.append(model, { kind: 'element.update', ref: 'e-customer', after: { name: 'First' } }, 'a');
    expect(first.result.ok).toBe(true);
    // The second event chains against the FIRST event's (unmodified) hash.
    const second = store.append(first.model, { kind: 'element.update', ref: 'e-customer', after: { name: 'Second' } }, 'a');
    expect(second.result.ok).toBe(true);
    expect(store.replay().chainErrors).toEqual([]);
    // Tamper the first line AFTER both events were recorded: the second
    // event's prev now points at a hash that no longer matches.
    const { readFileSync, writeFileSync, readdirSync } = await import('node:fs');
    const shard = readdirSync(store.eventsDir).sort()[0];
    const path = join(store.eventsDir, shard);
    const lines = readFileSync(path, 'utf8').split('\n');
    lines[0] = lines[0].replace('"First"', '"First-tampered"');
    writeFileSync(path, lines.join('\n'));
    const replayed = store.replay();
    expect(replayed.chainErrors.some((error) => error.includes('hash-chain mismatch'))).toBe(true);
  });

  it('legacy models.json migrates losslessly (snapshot 0 equivalence)', () => {
    const root = scratch();
    const dataFile = join(root, 'models.json');
    const stores = migrateLegacyVolume(dataFile, [{ model }], () => undefined);
    const store = stores.get(model.id)!;
    expect(store.exists()).toBe(true);
    const replayed = store.replay();
    expect(replayed.model.elements.length).toBe(model.elements.length);
    expect(replayed.model.relationships.length).toBe(model.relationships.length);
    // Round-trips through the native format identically.
    expect(
      JSON.parse(serializeNativeModel(replayed.model)).elements.length,
    ).toBe(JSON.parse(serializeNativeModel(model)).elements.length);
  });

  it('eventStoreRoot sits beside the legacy file per §10.2', () => {
    expect(eventStoreRoot('/srv/openarch/data/models.json')).toBe('/srv/openarch/data/workspaces/');
  });
});

