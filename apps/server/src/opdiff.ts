import type { Model, Op } from '@openarch/core';

/**
 * Build the op list that carries one whole-model save into the event log
 * (spec C2 compat layer): the diff between the stored model and the incoming
 * model decomposes into canonical ops the log understands, so the history
 * is complete from day one even while clients still PUT full models.
 */
export function buildOpsFromDiff(before: Model, after: Model): Op[] {
  const ops: Op[] = [];
  const beforeElements = new Map(before.elements.map((element) => [element.id, element]));
  const afterElements = new Map(after.elements.map((element) => [element.id, element]));

  // Elements: creates / updates / deletes.
  for (const [id, element] of afterElements) {
    const previous = beforeElements.get(id);
    if (!previous) {
      ops.push({ kind: 'element.create', ref: id, after: { type: element.type, name: element.name?.[0]?.value } });
      continue;
    }
    if (JSON.stringify(previous) !== JSON.stringify(element)) {
      const changes: Record<string, unknown> = {};
      if (previous.type !== element.type) changes.type = element.type;
      if ((previous.name?.[0]?.value ?? '') !== (element.name?.[0]?.value ?? '')) {
        changes.name = element.name?.[0]?.value ?? '';
      }
      if (previous.domain !== element.domain) changes.domain = element.domain;
      if (previous.environment !== element.environment) changes.environment = element.environment;
      ops.push({ kind: 'element.update', ref: id, after: changes });
    }
  }
  for (const [id] of beforeElements) {
    if (!afterElements.has(id)) {
      ops.push({ kind: 'element.delete', ref: id, after: {} });
    }
  }

  // Relationships.
  const beforeRels = new Map(before.relationships.map((relationship) => [relationship.id, relationship]));
  const afterRels = new Map(after.relationships.map((relationship) => [relationship.id, relationship]));
  for (const [id, relationship] of afterRels) {
    if (!beforeRels.has(id)) {
      ops.push({
        kind: 'relationship.create',
        ref: id,
        after: { type: relationship.type, source: relationship.source, target: relationship.target },
      });
    }
  }
  for (const [id] of beforeRels) {
    if (!afterRels.has(id)) {
      ops.push({ kind: 'relationship.delete', ref: id, after: {} });
    }
  }

  // Views: creates / deletes (positions/edges ride snapshots; compat ops stay coarse).
  const beforeViews = new Set(before.views.map((view) => view.id));
  const afterViews = new Map(after.views.map((view) => [view.id, view]));
  for (const [id, view] of afterViews) {
    if (!beforeViews.has(id)) {
      ops.push({ kind: 'view.create', ref: id, after: { name: view.name?.[0]?.value ?? 'View' } });
    }
  }
  for (const id of beforeViews) {
    if (!afterViews.has(id)) {
      ops.push({ kind: 'view.delete', ref: id, after: {} });
    }
  }

  return ops;
}

export function opKindCount(ops: Op[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const op of ops) {
    counts[op.kind] = (counts[op.kind] ?? 0) + 1;
  }
  return counts;
}
