import type { Model, Point } from './types';
import { primaryText } from './types';

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
