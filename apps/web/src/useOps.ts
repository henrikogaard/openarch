import { useCallback, useRef } from 'react';
import { applyIncomingOp, type OpSendResult } from './opsClient';
import type { Model, Op } from '@openarch/core';

/**
 * The C3 client hook: batches editor intents into op POSTs with immediate
 * local projection, and applies incoming RT op broadcasts to the open model.
 * Rejections surface with the server's rule; the caller decides between a
 * toast and the conflict review.
 */
export function useOps(options: {
  enabled: boolean;
  workspaceId?: string;
  getModel: () => Model | null;
  commitModel: (model: Model) => void;
  postOps: (workspaceId: string, ops: Op[]) => Promise<OpSendResult>;
  notify: (message: string) => void;
}) {
  const { enabled, workspaceId, getModel, commitModel, postOps, notify } = options;
  const inFlight = useRef(false);
  const queue = useRef<Op[]>([]);

  const flush = useCallback(
    async (ops?: Op[]) => {
      const id = workspaceId;
      if (!enabled || !id) return;
      if (ops?.length) queue.current.push(...ops);
      if (queue.current.length === 0 || inFlight.current) return;
      const batch = queue.current;
      queue.current = [];
      inFlight.current = true;
      try {
        const result = await postOps(id, batch);
        if (result.applied > 0) {
          notify(`Applied ${result.applied} change${result.applied === 1 ? '' : 's'}`);
        }
        for (const rejected of result.rejected) {
          const first = batch[rejected.seq - 1]; // seq is 1-based within the batch
          notify(`Rejected ${first?.kind ?? 'op'}: ${rejected.message}`);
        }
      } catch (error) {
        // Network failure: requeue so the next edit retries the whole batch —
        // the server's per-op gate makes replays safe (idempotent ops).
        queue.current = [...batch, ...queue.current];
        notify(`Not sent yet: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        inFlight.current = false;
      }
    },
    [enabled, workspaceId, postOps, notify],
  );

  /** Queue + immediately project an intent locally (C3's optimistic canvas). */
  const submitOp = useCallback(
    (op: Op) => {
      const current = getModel();
      if (!current) return;
      const projected = applyIncomingOp(current, op);
      if (projected.error) {
        // Client-side gate agrees with the server: do not even send.
        notify(`Cannot apply: ${projected.error}`);
        return;
      }
      commitModel(projected.model);
      void flush([op]);
    },
    [getModel, commitModel, notify, flush],
  );

  /** Apply a remote collaborator's op to the open model (RT `ops` event). */
  const receiveOp = useCallback(
    (op: Op, by?: string) => {
      const current = getModel();
      if (!current) return;
      const projected = applyIncomingOp(current, op);
      if (projected.error) {
        notify(`${by ?? 'A collaborator'} made a change you need to review — ${projected.error}`);
        return;
      }
      commitModel(projected.model);
    },
    [getModel, commitModel, notify],
  );

  return { submitOp, receiveOp, flush };
}
