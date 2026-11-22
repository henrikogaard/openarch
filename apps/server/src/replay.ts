import { applyOp, type Model } from '@openarch/core';
import type { WorkspaceEventStore } from './events';

/**
 * C4 replay helper: resolve the newest snapshot at-or-below `targetSeq` and
 * apply only the events up to that step — the point-in-time state, with the
 * same validation gate the full replay performs.
 */
export class ReplayAt {
  static replayTo(
    store: WorkspaceEventStore,
    targetSeq: number,
  ): { model: Model; version: number; chainErrors: string[] } {
    const snapshot = store.newestSnapshot(targetSeq);
    if (!snapshot) {
      return { model: store.replay().model, version: store.readMeta().version, chainErrors: [] };
    }
    const ops = store.readOps(snapshot.afterOps).filter((op) => op.seq <= targetSeq);
    let model = snapshot.model;
    const chainErrors: string[] = [];
    for (const op of ops) {
      try {
        model = applyOp(model, op);
      } catch (error) {
        chainErrors.push(`replay failed at seq ${op.seq}: ${(error as Error).message}`);
        break;
      }
    }
    const realTarget = Math.min(targetSeq, store.readMeta().version);
    return { model, version: realTarget, chainErrors };
  }
}
