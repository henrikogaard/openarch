import { createHash } from 'node:crypto';
import type {
  ArchiElement,
  Bounds,
  Domain,
  Model,
  Point,
  Relationship,
  View,
} from './types';
import { primaryText } from './types';
import { validateModel, type ValidationIssue } from './validation';
import {
  assignElements,
  removeElements,
  removeRelationships,
  alignNodes,
  distributeNodes,
  duplicateElements,
  groupNodes,
  ungroupNodes,
  setEdgeBendpoints,
  setNodeZOrder,
  elementRefsForNodes,
  relationshipRefsForEdges,
} from './workspace';
import { mergeModels } from './diff';

/**
 * The operation log core (spec C1, ADR 0004).
 *
 * An Op is the unit of tier-2 collaboration: small, idempotent, replayable,
 * and — the invariant that matters — NEVER enters history unless the
 * projected result validates. applyOp delegates to the same workspace helpers
 * the UI uses today (removeElements & co.), so all the invariant hardening of
 * the past week is reused, not forked. A CRDT would converge around bad ops;
 * this engine rejects them at the door.
 */
export type OpKind =
  | 'element.create'
  | 'element.update'
  | 'element.delete'
  | 'relationship.create'
  | 'relationship.delete'
  | 'view.create'
  | 'view.delete'
  | 'view.rename'
  | 'view.node.create'
  | 'view.node.move'
  | 'view.node.delete'
  | 'view.edge.create'
  | 'view.edge.delete'
  | 'view.edge.bendpoints'
  | 'domain.assign'
  | 'model.meta.update'
  | 'group.create'
  | 'group.dissolve';

export interface Op {
  seq?: number;
  actor?: string;
  at?: string;
  kind: OpKind;
  /** Primary entity id (element/relationship/view/domain). */
  ref: string;
  /** Presentational payload; validated per-kind before apply. */
  before?: Record<string, unknown> | null;
  after: Record<string, unknown>;
}

export class OpError extends Error {
  constructor(
    message: string,
    public readonly issues: ValidationIssue[] = [],
  ) {
    super(message);
  }
}

/** Structural pre-checks per kind — reject malformed ops before any mutation. */
export function canApply(model: Model, op: Op): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const element = model.elements.find((candidate) => candidate.id === op.ref);
  const view = model.views.find((candidate) => candidate.id === op.ref);
  switch (op.kind) {
    case 'element.create':
      if (model.elements.some((candidate) => candidate.id === op.ref)) {
        issues.push({ severity: 'error', rule: 'op.duplicate-id', message: `Element ${op.ref} already exists` });
      }
      if (typeof op.after.type !== 'string' || !op.after.type) {
        issues.push({ severity: 'error', rule: 'op.element-type', message: 'element.create requires after.type' });
      }
      break;
    case 'element.update':
    case 'element.delete':
    case 'domain.assign':
      if (!element) {
        issues.push({ severity: 'error', rule: 'op.missing-element', message: `Element ${op.ref} not found` });
      }
      break;
    case 'relationship.create':
      if (model.relationships.some((candidate) => candidate.id === op.ref)) {
        issues.push({ severity: 'error', rule: 'op.duplicate-id', message: `Relationship ${op.ref} already exists` });
      }
      if (typeof op.after.type !== 'string') {
        issues.push({ severity: 'error', rule: 'op.relationship-type', message: 'relationship.create requires after.type' });
      }
      break;
    case 'relationship.delete':
    case 'view.edge.delete':
      if (!model.relationships.some((candidate) => candidate.id === op.ref)) {
        issues.push({ severity: 'error', rule: 'op.missing-relationship', message: `Relationship ${op.ref} not found` });
      }
      break;
    case 'view.create':
      if (model.views.some((candidate) => candidate.id === op.ref)) {
        issues.push({ severity: 'error', rule: 'op.duplicate-id', message: `View ${op.ref} already exists` });
      }
      break;
    case 'view.delete':
      if (!view) {
        issues.push({ severity: 'error', rule: 'op.missing-view', message: `View ${op.ref} not found` });
      } else if (model.views.length <= 1) {
        issues.push({ severity: 'error', rule: 'op.last-view', message: 'A workspace needs at least one view' });
      }
      break;
    case 'view.rename':
    case 'view.node.create':
    case 'view.node.move':
    case 'view.node.delete':
    case 'view.edge.create':
    case 'view.edge.bendpoints':
    case 'group.create':
    case 'group.dissolve':
      if (!view) {
        issues.push({ severity: 'error', rule: 'op.missing-view', message: `View ${op.ref} not found` });
      }
      break;
    case 'model.meta.update':
      break;
  }
  return issues;
}

/**
 * Project the op result WITHOUT keeping it: return the projected model and
 * its validation issues so the caller (server op endpoint) can reject or
 * append. Pure: the input model is never mutated.
 */
export function tryApplyOp(model: Model, op: Op): { model: Model; issues: ValidationIssue[] } {
  const structural = canApply(model, op);
  if (structural.some((issue) => issue.severity === 'error')) {
    return { model, issues: structural };
  }
  const projected = applyKind(model, op);
  const issues = validateModel(projected);
  return { model: projected, issues };
}

/**
 * Apply an op; throws OpError when the result would be invalid (spec C1:
 * "an invalid op can never produce an invalid model").
 */
export function applyOp(model: Model, op: Op): Model {
  const { model: projected, issues } = tryApplyOp(model, op);
  const errors = issues.filter((issue) => issue.severity === 'error');
  if (errors.length) {
    throw new OpError(
      `Op ${op.kind} on ${op.ref} rejected: ${errors[0].message}`,
      issues,
    );
  }
  return projected;
}

function applyKind(model: Model, op: Op): Model {
  switch (op.kind) {
    case 'element.create': {
      const element: ArchiElement = {
        id: op.ref,
        type: String(op.after.type),
        name: [{ lang: 'en', value: String(op.after.name ?? 'Unnamed') }],
        documentation: [],
        properties: [],
        domain: typeof op.after.domain === 'string' ? op.after.domain : undefined,
        environment: typeof op.after.environment === 'string' ? op.after.environment : undefined,
      };
      return { ...model, elements: [...model.elements, element] };
    }
    case 'element.update': {
      const patch: Partial<ArchiElement> = {};
      if (typeof op.after.name === 'string') patch.name = [{ lang: 'en', value: op.after.name }];
      if (typeof op.after.type === 'string') patch.type = op.after.type;
      if ('domain' in op.after) patch.domain = typeof op.after.domain === 'string' ? op.after.domain : undefined;
      if ('environment' in op.after) patch.environment = typeof op.after.environment === 'string' ? op.after.environment : undefined;
      return {
        ...model,
        elements: model.elements.map((candidate) =>
          candidate.id === op.ref ? { ...candidate, ...patch } : candidate,
        ),
      };
    }
    case 'element.delete':
      return removeElements(model, [op.ref]);
    case 'relationship.create': {
      const relationship: Relationship = {
        id: op.ref,
        type: String(op.after.type),
        source: String(op.after.source),
        target: String(op.after.target),
        name: typeof op.after.name === 'string' ? [{ lang: 'en', value: op.after.name }] : [],
        documentation: [],
        properties: [],
      };
      return { ...model, relationships: [...model.relationships, relationship] };
    }
    case 'relationship.delete':
      return removeRelationships(model, [op.ref]);
    case 'view.create': {
      const view: View = {
        id: op.ref,
        type: 'Diagram',
        name: [{ lang: 'en', value: String(op.after.name ?? 'View') }],
        nodes: [],
        edges: [],
      };
      return { ...model, views: [...model.views, view] };
    }
    case 'view.delete':
      return { ...model, views: model.views.filter((candidate) => candidate.id !== op.ref) };
    case 'view.rename':
      return {
        ...model,
        views: model.views.map((candidate) =>
          candidate.id === op.ref ? { ...candidate, name: [{ lang: 'en', value: String(op.after.name ?? '') }] } : candidate,
        ),
      };
    case 'view.node.create': {
      const nodeId = String(op.after.nodeId);
      const bounds = (op.after.bounds ?? { x: 100, y: 100, w: 170, h: 64 }) as Bounds;
      return {
        ...model,
        views: model.views.map((candidate) =>
          candidate.id === op.ref
            ? {
                ...candidate,
                nodes: [
                  ...candidate.nodes,
                  { id: nodeId, type: 'Element', elementRef: String(op.after.elementRef), label: [], bounds },
                ],
              }
            : candidate,
        ),
      };
    }
    case 'view.node.move': {
      const nodeId = String(op.after.nodeId);
      const bounds = op.after.bounds as Bounds;
      return {
        ...model,
        views: model.views.map((candidate) =>
          candidate.id === op.ref
            ? {
                ...candidate,
                nodes: candidate.nodes.map((node) => (node.id === nodeId ? { ...node, bounds } : node)),
              }
            : candidate,
        ),
      };
    }
    case 'view.node.delete': {
      const nodeId = String(op.after.nodeId);
      const element = model.views
        .find((candidate) => candidate.id === op.ref)
        ?.nodes.find((node) => node.id === nodeId)?.elementRef;
      // Deleting a node deletes its element from the canonical model (the
      // same contract the canvas delete uses today).
      if (!element) return model;
      return removeElements(model, [element]);
    }
    case 'view.edge.create': {
      const edgeId = String(op.after.edgeId);
      return {
        ...model,
        views: model.views.map((candidate) =>
          candidate.id === op.ref
            ? {
                ...candidate,
                edges: [
                  ...candidate.edges,
                  {
                    id: edgeId,
                    type: 'Relationship',
                    relationshipRef: op.ref,
                    source: String(op.after.sourceNodeId),
                    target: String(op.after.targetNodeId),
                    bendpoints: [],
                  },
                ],
              }
            : candidate,
        ),
      };
    }
    case 'view.edge.delete': {
      const edgeIds = Array.isArray(op.after.edgeIds) ? (op.after.edgeIds as string[]) : [];
      const relationshipIds = model.views.flatMap((view) =>
        view.edges.filter((edge) => edgeIds.includes(edge.id)).map((edge) => edge.relationshipRef),
      );
      const fromRef = relationshipIds.length ? relationshipIds : [op.ref];
      return removeRelationships(model, fromRef);
    }
    case 'view.edge.bendpoints': {
      const edgeId = String(op.after.edgeId);
      const bendpoints = (op.after.bendpoints ?? []) as Point[];
      return setEdgeBendpoints(model, op.ref, edgeId, bendpoints);
    }
    case 'domain.assign': {
      const patch = {
        domain: typeof op.after.domain === 'string' ? op.after.domain : undefined,
        ...(op.after.environment !== undefined
          ? { environment: typeof op.after.environment === 'string' ? op.after.environment : undefined }
          : {}),
      };
      return assignElements(model, [op.ref], patch);
    }
    case 'model.meta.update': {
      const patch: Partial<Model> = {};
      if (typeof op.after.name === 'string') patch.name = [{ lang: 'en', value: op.after.name }];
      if (typeof op.after.owner === 'string') patch.owner = op.after.owner;
      if (typeof op.after.purpose === 'string') patch.purpose = op.after.purpose as Model['purpose'];
      if (typeof op.after.status === 'string') patch.status = op.after.status as Model['status'];
      return { ...model, ...patch };
    }
    case 'group.create': {
      const nodeIds = Array.isArray(op.after.nodeIds) ? (op.after.nodeIds as string[]) : [];
      return groupNodes(model, op.ref, nodeIds);
    }
    case 'group.dissolve': {
      const nodeIds = Array.isArray(op.after.nodeIds) ? (op.after.nodeIds as string[]) : [];
      return ungroupNodes(model, op.ref, nodeIds);
    }
  }
}

/** Deterministic idempotency key (spec §2): same actor+kind+ref+payload twice = same op. */
export function idempotencyKey(actor: string, op: Op): string {
  const canonical = JSON.stringify({ actor, kind: op.kind, ref: op.ref, after: op.after });
  return createHash('sha256').update(canonical).digest('hex');
}

/** Serialize/parses op lines for shards (spec §2 op format). */
export function serializeOp(op: Op): string {
  return JSON.stringify(op);
}

export function parseOp(line: string): Op {
  const parsed = JSON.parse(line) as Op;
  if (!parsed.kind || typeof parsed.ref !== 'string') {
    throw new Error(`Malformed op: ${line.slice(0, 80)}`);
  }
  return parsed;
}

export { mergeModels };
