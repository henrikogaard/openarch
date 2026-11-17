import type { Model } from '@openarch/core';
import { primaryText } from '@openarch/core';

/** A structural comparison of two models. */
export interface ModelDiff {
  addedElements: string[];
  removedElements: string[];
  changedElements: Array<{ id: string; field: string; from: string; to: string }>;
  addedRelationships: string[];
  removedRelationships: string[];
}

function describeElement(element: { id: string; type: string; name: Model['name'] }): string {
  const label = primaryText(element.name) || element.type;
  return `${element.id} (${label})`;
}

function relationshipTuple(relationship: {
  type: string;
  source: string;
  target: string;
}): string {
  return `${relationship.type}\u0000${relationship.source}\u0000${relationship.target}`;
}

function describeRelationship(relationship: {
  id: string;
  type: string;
  source: string;
  target: string;
}): string {
  return `${relationship.id}: ${relationship.type} (${relationship.source} -> ${relationship.target})`;
}

function compareField(
  diff: ModelDiff,
  id: string,
  field: string,
  from: string,
  to: string,
): void {
  if (from !== to) {
    diff.changedElements.push({ id, field, from, to });
  }
}

/**
 * Compare two models element-by-element and relationship-by-relationship.
 *
 * Elements are matched by id; their name, type and documentation are compared.
 * Relationships are matched by id or by their (type, source, target) tuple.
 */
export function diffModels(a: Model, b: Model): ModelDiff {
  const diff: ModelDiff = {
    addedElements: [],
    removedElements: [],
    changedElements: [],
    addedRelationships: [],
    removedRelationships: [],
  };

  const aElements = new Map(a.elements.map((element) => [element.id, element]));
  const bElements = new Map(b.elements.map((element) => [element.id, element]));

  for (const [id, element] of aElements) {
    if (!bElements.has(id)) {
      diff.removedElements.push(describeElement(element));
    }
  }

  for (const [id, element] of bElements) {
    const before = aElements.get(id);
    if (!before) {
      diff.addedElements.push(describeElement(element));
      continue;
    }
    compareField(diff, id, 'name', primaryText(before.name), primaryText(element.name));
    compareField(diff, id, 'type', before.type, element.type);
    compareField(
      diff,
      id,
      'documentation',
      primaryText(before.documentation),
      primaryText(element.documentation),
    );
  }

  const aRelationshipIds = new Set(a.relationships.map((relationship) => relationship.id));
  const bRelationshipIds = new Set(b.relationships.map((relationship) => relationship.id));
  const aTuples = new Set(a.relationships.map(relationshipTuple));
  const bTuples = new Set(b.relationships.map(relationshipTuple));

  for (const relationship of a.relationships) {
    if (!bRelationshipIds.has(relationship.id) && !bTuples.has(relationshipTuple(relationship))) {
      diff.removedRelationships.push(describeRelationship(relationship));
    }
  }
  for (const relationship of b.relationships) {
    if (!aRelationshipIds.has(relationship.id) && !aTuples.has(relationshipTuple(relationship))) {
      diff.addedRelationships.push(describeRelationship(relationship));
    }
  }

  return diff;
}
