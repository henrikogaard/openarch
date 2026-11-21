import {
  applyOp,
  type Model,
  type Op,
  type RelationshipTypeDefinition,
} from '@openarch/core';

/**
 * C3 client: translate UI intents into ordered op batches with an immediate
 * local projection (applyOp) so the canvas updates before the server responds.
 * A rejected op carries the server's rule + message for the conflict UX.
 */
export interface QueuedOp {
  op: Op;
  /** Fallback whole-model save when an intent is not op-representable. */
  nonOp?: boolean;
}

export interface OpSendResult {
  applied: number;
  rejected: Array<{ seq: number; rule: string; message: string }>;
  version: number;
}

export type OpPoster = (workspaceId: string, ops: Op[]) => Promise<OpSendResult>;


/**
 * Derive canonical ops for common editor intents (the same shapes the server
 * accepts). The canvas already knows the ids; these helpers keep the client
 * and server honest: identical payload ⇒ identical op ⇒ identical history.
 */
export const intentOps = {
  elementCreate: (element: { id: string; type: string; name: string }): Op => ({
    kind: 'element.create',
    ref: element.id,
    after: { type: element.type, name: element.name },
  }),
  elementRename: (id: string, name: string): Op => ({
    kind: 'element.update',
    ref: id,
    after: { name },
  }),
  elementDomain: (id: string, domain?: string): Op => ({
    kind: 'domain.assign',
    ref: id,
    after: { domain },
  }),
  elementDelete: (id: string): Op => ({ kind: 'element.delete', ref: id, after: {} }),
  relationshipCreate: (
    id: string,
    type: string,
    source: string,
    target: string,
  ): Op => ({ kind: 'relationship.create', ref: id, after: { type, source, target } }),
  relationshipDelete: (id: string): Op => ({ kind: 'relationship.delete', ref: id, after: {} }),
  viewNodeCreate: (viewId: string, nodeId: string, elementRef: string, x: number, y: number): Op => ({
    kind: 'view.node.create',
    ref: viewId,
    after: { nodeId, elementRef, bounds: { x, y, w: 170, h: 64 } },
  }),
  viewNodeMove: (viewId: string, nodeId: string, bounds: { x: number; y: number; w: number; h: number }): Op => ({
    kind: 'view.node.move',
    ref: viewId,
    after: { nodeId, bounds },
  }),
  viewNodeDelete: (viewId: string, nodeId: string): Op => ({
    kind: 'view.node.delete',
    ref: viewId,
    after: { nodeId },
  }),
};

export type RelationshipChoice = RelationshipTypeDefinition | { type: string };

export const isRelationshipDefinition = (
  choice: RelationshipChoice,
): choice is RelationshipTypeDefinition => 'id' in choice;

/**
 * Apply an incoming RT op directly onto the open model (live collaboration):
 * returns the projected model or the op (with reasons) if it cannot apply —
 * callers render a toast and refresh the model from the server on failure,
 * never silently dropping traffic.
 */
export function applyIncomingOp(model: Model, op: Op): { model: Model; error?: string } {
  try {
    return { model: applyOp(model, op) };
  } catch (error) {
    return { model, error: (error as Error).message };
  }
}
