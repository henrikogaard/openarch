import type { Model, Point } from './types';
import { primaryText } from './types';
import { mergeModels } from './diff';

export interface ConflictEntry {
  id: string;
  label: string;
  status: 'identical' | 'changed' | 'theirs-only' | 'yours-only' | 'both-added';
  yours?: string;
  theirs?: string;
}

/**
 * Derive a per-entity conflict list between "yours" (current) and "theirs"
 * (server copy), grouped for a three-pane review: identical entries only when
 * interesting, and changed/added/removed entries as reconcilable rows.
 */
export function conflictEntries(yours: Model, theirs: Model): ConflictEntry[] {
  const entries: ConflictEntry[] = [];
  const yoursElements = new Map(yours.elements.map((element) => [element.id, element]));
  const theirsElements = new Map(theirs.elements.map((element) => [element.id, element]));
  for (const [id, yoursElement] of yoursElements) {
    const theirsElement = theirsElements.get(id);
    if (!theirsElement) {
      entries.push({ id, label: `${primaryText(yoursElement.name) || id} (${yoursElement.type})`, status: 'yours-only', yours: id });
      continue;
    }
    if (JSON.stringify(yoursElement) !== JSON.stringify(theirsElement)) {
      entries.push({
        id,
        label: `${primaryText(theirsElement.name) || id} (${theirsElement.type})`,
        status: 'changed',
        yours: summaryOf(yoursElement),
        theirs: summaryOf(theirsElement),
      });
    }
  }
  for (const [id, theirsElement] of theirsElements) {
    if (!yoursElements.has(id)) {
      entries.push({ id, label: `${primaryText(theirsElement.name) || id} (${theirsElement.type})`, status: 'theirs-only', theirs: id });
    }
  }
  // Report relationships similarly (concise counts drive labels only).
  const yoursRels = new Map(yours.relationships.map((rel) => [rel.id, rel]));
  const theirsRels = new Map(theirs.relationships.map((rel) => [rel.id, rel]));
  for (const [id, yoursRel] of yoursRels) {
    const theirsRel = theirsRels.get(id);
    if (!theirsRel) {
      entries.push({ id, label: `${yoursRel.type}: ${yoursRel.source} → ${yoursRel.target}`, status: 'yours-only', yours: id });
    } else if (JSON.stringify(yoursRel) !== JSON.stringify(theirsRel)) {
      entries.push({ id, label: `${theirsRel.type}: ${theirsRel.source} → ${theirsRel.target}`, status: 'changed', yours: id, theirs: id });
    }
  }
  for (const [id, theirsRel] of theirsRels) {
    if (!yoursRels.has(id)) {
      entries.push({ id, label: `${theirsRel.type}: ${theirsRel.source} → ${theirsRel.target}`, status: 'theirs-only', theirs: id });
    }
  }
  return entries;
}

function summaryOf(element: { name: Array<{ value: string }>; type: string; domain?: string; environment?: string }): string {
  const name = primaryText(element.name);
  return [name, element.type, element.domain, element.environment].filter(Boolean).join(' · ');
}

/** Overlay pins for canvas comments: comment id → anchoring node information. */
export interface CommentPin {
  commentId: string;
  nodeId?: string;
  position?: Point;
}

/** Map comments with elementId to canvas coordinates for pin overlays. */
export function commentPins(
  model: Model,
  comments: Array<{ id: string; elementId?: string }>,
): CommentPin[] {
  const pins: CommentPin[] = [];
  for (const comment of comments) {
    if (!comment.elementId) continue;
    const node = model.views
      .flatMap((view) => view.nodes)
      .find((candidate) => candidate.elementRef === comment.elementId);
    if (!node) continue;
    pins.push({
      commentId: comment.id,
      nodeId: node.id,
      position: { x: node.bounds.x, y: node.bounds.y },
    });
  }
  return pins;
}

export type Resolution = 'mine' | 'theirs';

/**
 * Compose a reviewed model from a conflict: start from semantic
 * `mergeModels` (which never deletes), then let per-entity resolutions veto
 * specific automatic outcomes:
 * - 'mine' on an entity that merge would take from theirs restores OUR
 *   version of that element/relationship and drops theirs;
 * - 'theirs' on an entity we own forces THEIR version and drops ours.
 * Views stay reconciled by mergeModels (edge faithfulness invariants).
 */
export function applyResolutions(yours: Model, theirs: Model, resolutions: Map<string, Resolution>): Model {
  if (resolutions.size === 0) return mergeModels(yours, theirs);
  const keepMine = new Set<string>();
  const keepTheirs = new Set<string>();
  for (const [id, resolution] of resolutions) {
    if (resolution === 'mine') keepMine.add(id);
    else keepTheirs.add(id);
  }
  const shadowTheirs: Model = {
    ...theirs,
    elements: theirs.elements.filter((element) => !keepMine.has(element.id)),
    relationships: theirs.relationships.filter((relationship) => !keepMine.has(relationship.id)),
  };
  const incorporated = mergeModels(yours, shadowTheirs);
  const elements = incorporated.elements.map((element) => {
    if (keepMine.has(element.id)) {
      const mine = yours.elements.find((candidate) => candidate.id === element.id);
      if (mine) return mine;
    }
    if (keepTheirs.has(element.id)) {
      const theirVersion = theirs.elements.find((candidate) => candidate.id === element.id);
      if (theirVersion) return theirVersion;
    }
    return element;
  });
  const relationships = incorporated.relationships.map((relationship) => {
    if (keepMine.has(relationship.id)) {
      const mine = yours.relationships.find((candidate) => candidate.id === relationship.id);
      if (mine) return mine;
    }
    if (keepTheirs.has(relationship.id)) {
      const theirVersion = theirs.relationships.find((candidate) => candidate.id === relationship.id);
      if (theirVersion) return theirVersion;
    }
    return relationship;
  });
  // Keep the merge invariants: prune edges that no longer depict faithfully.
  const relationshipIndex = new Map(relationships.map((relationship) => [relationship.id, relationship]));
  const views = incorporated.views.map((view) => ({
    ...view,
    edges: view.edges.filter((edge) => {
      const relationship = relationshipIndex.get(edge.relationshipRef);
      if (!relationship) return false;
      const sourceNode = view.nodes.find((node) => node.id === edge.source);
      const targetNode = view.nodes.find((node) => node.id === edge.target);
      return (
        sourceNode?.elementRef === relationship.source && targetNode?.elementRef === relationship.target
      );
    }),
  }));
  return { ...incorporated, elements, relationships, views };
}


/** Count comments anchored to each canvas node (pins), for the editor overlay. */
export function commentCountsByNode(
  model: Model,
  comments: Array<{ id: string; elementId?: string }>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const pin of commentPins(model, comments)) {
    if (!pin.nodeId) continue;
    counts.set(pin.nodeId, (counts.get(pin.nodeId) ?? 0) + 1);
  }
  return counts;
}
