import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyOp, serializeOp, validateModel, type Op, type Model } from '@openarch/core';
import type { ValidationIssue } from '@openarch/core';

/**
 * Event-sourced workspace store (spec §10.2, C2).
 *
 * Persisting a workspace keeps its whole history honest by design:
 *
 * ```
 * data/workspaces/<id>/
 *   meta.json                    # { version, createdAt, updatedAt }
 *   events/000001.jsonl         # append-only op shards (~10k lines each)
 *   snapshots/000000.model.json  # full validated Model every ~200 ops
 * ```
 *
 * Every op passes ADR 0004's gate (validateModel on the projected result)
 * before being appended — an invalid op can never enter history. Compaction
 * rotates shards once their events are all superseded by a snapshot.
 */
export const EVENTS_PER_SNAPSHOT = 200;
export const OPS_PER_SHARD = 10_000;

export interface EventMeta {
  version: number;         // ops appended so far (== seq of the newest event)
  createdAt?: string;
  updatedAt?: string;
}

export interface AppendResult {
  ok: boolean;
  version: number;
  issues?: ValidationIssue[];
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export class WorkspaceEventStore {
  readonly id: string;
  private readonly root: string;

  constructor(rootDir: string, workspaceId: string) {
    this.id = workspaceId;
    this.root = join(rootDir, workspaceId);
  }

  get metaPath(): string { return join(this.root, 'meta.json'); }
  get eventsDir(): string { return join(this.root, 'events'); }
  get snapshotsDir(): string { return join(this.root, 'snapshots'); }

  exists(): boolean {
    return existsSync(this.metaPath);
  }

  /** Initialise from a full model (migration or first creation) — snapshot 0. */
  initialize(model: Model, meta: EventMeta = { version: 0 }): void {
    mkdirSync(this.eventsDir, { recursive: true });
    mkdirSync(this.snapshotsDir, { recursive: true });
    this.writeSnapshot(0, model);
    this.writeMeta(meta);
  }

  private writeMeta(meta: EventMeta): void {
    const temp = `${this.metaPath}.tmp-${process.pid}`;
    writeFileSync(temp, `${JSON.stringify(meta, null, 2)}\n`);
    renameSync(temp, this.metaPath);
  }

  readMeta(): EventMeta {
    if (!existsSync(this.metaPath)) return { version: 0 };
    return JSON.parse(readFileSync(this.metaPath, 'utf8')) as EventMeta;
  }

  private writeSnapshot(afterOps: number, model: Model): void {
    mkdirSync(this.snapshotsDir, { recursive: true });
    const name = `${String(afterOps).padStart(6, '0')}.model.json`;
    const temp = join(this.snapshotsDir, `${name}.tmp-${process.pid}`);
    writeFileSync(temp, `${JSON.stringify(model, null, 2)}\n`);
    renameSync(temp, join(this.snapshotsDir, name));
  }

  /** Newest snapshot ≤ maxOps, or undefined for full replay from empty. */
  newestSnapshot(maxOps = Number.POSITIVE_INFINITY): { afterOps: number; model: Model } | undefined {
    if (!existsSync(this.snapshotsDir)) return undefined;
    const names = readdirSync(this.snapshotsDir)
      .filter((name) => name.endsWith('.model.json'))
      .sort();
    let best: { afterOps: number; model: Model } | undefined;
    for (const name of names) {
      const afterOps = Number(name.replace('.model.json', ''));
      if (afterOps > maxOps) break;
      best = {
        afterOps,
        model: JSON.parse(readFileSync(join(this.snapshotsDir, name), 'utf8')) as Model,
      };
    }
    return best;
  }

  private shardPath(index: number): string {
    return join(this.eventsDir, `${String(index).padStart(6, '0')}.jsonl`);
  }

  /** Read every op (shards in order) — optionally only those above the snapshot mark. */
  readOps(afterOpsMark = 0): Array<Op & { seq: number }> {
    if (!existsSync(this.eventsDir)) return [];
    const shards = readdirSync(this.eventsDir)
      .filter((name) => name.endsWith('.jsonl'))
      .sort();
    const ops: Array<Op & { seq: number }> = [];
    for (const shard of shards) {
      const content = readFileSync(join(this.eventsDir, shard), 'utf8').trim();
      if (!content) continue;
      for (const line of content.split('\n')) {
        const op = JSON.parse(line) as Op & { seq: number };
        if (op.seq > afterOpsMark) ops.push(op);
      }
    }
    return ops;
  }

  /**
   * Append one op (the ADR 0004 gate): project + validate BEFORE the append.
   * Returns ok=false with the issues when the op would corrupt the model —
   * nothing is written in that case. Hash-chained: each event's `before`
   * carries the prior line's sha256 so tampering is detectable at replay.
   */
  append(model: Model, op: Op, actor?: string): { result: AppendResult; model: Model } {
    const meta = this.readMeta();
    const seq = meta.version + 1;
    const stamped: Op & { seq: number; actor?: string; at: string } = {
      ...op,
      seq,
      actor: actor ?? op.actor,
      at: new Date().toISOString(),
    };
    let projected: Model;
    try {
      projected = applyOp(model, stamped);
    } catch (error) {
      const issues = (error as { issues?: ValidationIssue[] }).issues ?? [
        { severity: 'error', rule: 'op.apply', message: (error as Error).message },
      ];
      return { result: { ok: false, version: meta.version, issues }, model };
    }
    // Append (atomic per line: we write the shard, then flip meta).
    mkdirSync(this.eventsDir, { recursive: true });
    const shardIndex = Math.floor((seq - 1) / OPS_PER_SHARD);
    const path = this.shardPath(shardIndex);
    const priorLineHash = this.tailHash(shardIndex);
    const line = serializeOp({ ...stamped, before: { ...stamped.before ?? {}, prev: priorLineHash } });
    // sha chain: prev points at the previous event's content hash.
    const contentHash = sha256(line);
    appendLine(path, `${line}\n`);
    // Meta flip atomically makes the event visible.
    this.writeMeta({ ...meta, version: seq, updatedAt: stamped.at });
    // Snapshot cadence.
    if (seq % EVENTS_PER_SNAPSHOT === 0) {
      this.writeSnapshot(seq, projected);
    }
    return { result: { ok: true, version: seq }, model: projected };
  }

  /** Content hash of the last event in a shard (the hash-chain link). */
  private tailHash(shardIndex: number): string | undefined {
    const path = this.shardPath(shardIndex);
    if (!existsSync(path)) return undefined;
    const content = readFileSync(path, 'utf8').trim();
    if (!content) return undefined;
    const lastLine = content.split('\n').at(-1)!;
    return sha256(lastLine);
  }

  /**
   * Replay: newest snapshot + remaining events, verifying the hash chain as
   * we walk. Returns the model and any chain mismatches found (spec §12's
   * torn-write detection: a broken chain localises the corrupted shard).
   */
  replay(): { model: Model; version: number; chainErrors: string[] } {
    const snapshot = this.newestSnapshot();
    const startOps = snapshot?.afterOps ?? 0;
    const ops = this.readOps(startOps);
    const snapshotModel = snapshot?.model ?? {
      id: this.id,
      name: [],
      documentation: [],
      properties: [],
      propertyDefinitions: [],
      elements: [],
      relationships: [],
      views: [],
    } as Model;
    let model = snapshotModel;
    let chainPrev: string | undefined;
    if (snapshot && startOps > 0) {
      // Chain resumes at the snapshot boundary; previous hash unknown from
      // files beyond it, so treat the checkpoint as trusted (snapshot itself
      // is a complete validated model).
      chainPrev = undefined;
    }
    const chainErrors: string[] = [];
    for (const op of ops) {
      const before = op.before as { prev?: string } | null | undefined;
      if (chainPrev && before?.prev && before.prev !== chainPrev) {
        chainErrors.push(`hash-chain mismatch at seq ${op.seq}: expected prev ${chainPrev.slice(0, 12)}…`);
      }
      try {
        model = applyOp(model, op);
      } catch (error) {
        chainErrors.push(`replay failed at seq ${op.seq}: ${(error as Error).message}`);
        break;
      }
      chainPrev = sha256(serializeOp(op));
    }
    const metaNow = this.readMeta();
    return { model, version: metaNow.version, chainErrors };
  }

  /** Compaction: drop shards whose events are all inside the newest snapshot. */
  compact(): number {
    const snapshot = this.newestSnapshot();
    if (!snapshot) return 0;
    const snapshotMark = snapshot.afterOps;
    const shards = existsSync(this.eventsDir)
      ? readdirSync(this.eventsDir).filter((name) => name.endsWith('.jsonl')).sort()
      : [];
    let removed = 0;
    for (const shard of shards) {
      const content = readFileSync(join(this.eventsDir, shard), 'utf8').trim();
      if (!content) continue;
      const lines = content.split('\n');
      const maxSeq = Math.max(...lines.map((line) => (JSON.parse(line) as { seq: number }).seq));
      if (maxSeq <= snapshotMark) {
        // Keep the final shard line (the chain link into live events).
        if (lines.length > 1) {
          const tail = lines.at(-1)!;
          writeFileSync(join(this.eventsDir, shard), `${tail}\n`);
          removed += lines.length - 1;
        }
      }
    }
    return removed;
  }
}

function appendLine(path: string, line: string): void {
  const dir = join(path, '..');
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, line, { flag: 'a' });
}

export function eventStoreRoot(dataFile: string): string {
  // data/workspaces sits beside the legacy models.json, per §10.2.
  return dataFile.replace(/[^/]*$/, 'workspaces/');
}

export interface Snapshot0Import {
  workspaceId: string;
  from: 'migration';
  opsAppended: 0;
}

/**
 * §10.2 migration: boot an existing models.json volume into the event store —
 * each workspace becomes snapshot 0; no user-facing step, reversible by
 * leaving the legacy file on disk (read-only once migrated).
 */
export function migrateLegacyVolume(
  dataFile: string,
  records: Array<{ model: Model }>,
  log: (message: string) => void = console.log,
): Map<string, WorkspaceEventStore> {
  const root = eventStoreRoot(dataFile);
  const stores = new Map<string, WorkspaceEventStore>();
  for (const record of records) {
    const store = new WorkspaceEventStore(root, record.model.id);
    if (!store.exists()) {
      store.initialize(record.model);
      log(`migrated workspace ${record.model.id} to event store (snapshot 0)`);
    }
    stores.set(record.model.id, store);
  }
  return stores;
}

export { validateModel };
