import { primaryText, type Model } from './types';

export interface FieldChange {
  entityId: string;
  field: string;
  from: string;
  to: string;
}

export interface ModelDiff {
  addedElements: string[];
  removedElements: string[];
  changedElements: FieldChange[];
  addedRelationships: string[];
  removedRelationships: string[];
  changedRelationships: FieldChange[];
  addedViews: string[];
  removedViews: string[];
}

export function diffModels(before: Model, after: Model): ModelDiff {
  const beforeElements = new Map(before.elements.map((element) => [element.id, element]));
  const afterElements = new Map(after.elements.map((element) => [element.id, element]));
  const diff: ModelDiff = {
    addedElements: [],
    removedElements: [],
    changedElements: [],
    addedRelationships: [],
    removedRelationships: [],
    changedRelationships: [],
    addedViews: [],
    removedViews: [],
  };

  for (const [id, element] of afterElements) {
    const previous = beforeElements.get(id);
    if (!previous) {
      diff.addedElements.push(`${id} (${primaryText(element.name) || element.type})`);
      continue;
    }
    compareFields(id, previous.name, element.name, diff.changedElements, 'name');
    compareFields(id, previous.documentation, element.documentation, diff.changedElements, 'documentation');
    if (previous.type !== element.type) {
      diff.changedElements.push({ entityId: id, field: 'type', from: previous.type, to: element.type });
    }
  }
  for (const id of beforeElements.keys()) {
    if (!afterElements.has(id)) diff.removedElements.push(id);
  }

  const beforeRelationships = new Map(before.relationships.map((relationship) => [relationship.id, relationship]));
  const afterRelationships = new Map(after.relationships.map((relationship) => [relationship.id, relationship]));
  for (const [id, relationship] of afterRelationships) {
    if (!beforeRelationships.has(id)) {
      diff.addedRelationships.push(`${relationship.type}: ${relationship.source} → ${relationship.target}`);
      continue;
    }
    const previous = beforeRelationships.get(id)!;
    if (previous.type !== relationship.type || previous.source !== relationship.source || previous.target !== relationship.target) {
      diff.changedRelationships.push({
        entityId: id,
        field: 'relationship',
        from: `${previous.type}: ${previous.source} → ${previous.target}`,
        to: `${relationship.type}: ${relationship.source} → ${relationship.target}`,
      });
    }
  }
  for (const id of beforeRelationships.keys()) {
    if (!afterRelationships.has(id)) diff.removedRelationships.push(id);
  }

  const beforeViews = new Set(before.views.map((view) => view.id));
  const afterViews = new Set(after.views.map((view) => view.id));
  diff.addedViews = [...afterViews].filter((id) => !beforeViews.has(id));
  diff.removedViews = [...beforeViews].filter((id) => !afterViews.has(id));

  return diff;
}

function compareFields(
  entityId: string,
  before: Array<{ value: string }>,
  after: Array<{ value: string }>,
  target: FieldChange[],
  field: string,
): void {
  const from = before.map((item) => item.value).join(' | ');
  const to = after.map((item) => item.value).join(' | ');
  if (from !== to) target.push({ entityId, field, from, to });
}

export function diffSummary(diff: ModelDiff): string {
  const parts = [
    `${diff.addedElements.length} elements added`,
    `${diff.removedElements.length} elements removed`,
    `${diff.changedElements.length} elements changed`,
    `${diff.addedRelationships.length} relationships added`,
    `${diff.removedRelationships.length} relationships removed`,
    `${diff.changedRelationships.length} relationships changed`,
    `${diff.addedViews.length} views added`,
    `${diff.removedViews.length} views removed`,
  ];
  return parts.join(', ');
}

export function hasChanges(diff: ModelDiff): boolean {
  return (
    diff.addedElements.length > 0 ||
    diff.removedElements.length > 0 ||
    diff.changedElements.length > 0 ||
    diff.addedRelationships.length > 0 ||
    diff.removedRelationships.length > 0 ||
    diff.changedRelationships.length > 0 ||
    diff.addedViews.length > 0 ||
    diff.removedViews.length > 0
  );
}

/**
 * Merge an incoming model into the current one: incoming wins on conflicts
 * (same id), current-only entities are kept, and view references that would
 * dangle are pruned. Unlike replace, nothing in the current model is deleted.
 */
export function mergeModels(current: Model, incoming: Model): Model {
  const elements = new Map(current.elements.map((element) => [element.id, element]));
  for (const element of incoming.elements) elements.set(element.id, element);
  const relationships = new Map(current.relationships.map((relationship) => [relationship.id, relationship]));
  for (const relationship of incoming.relationships) relationships.set(relationship.id, relationship);
  const views = new Map(current.views.map((view) => [view.id, view]));
  for (const view of incoming.views) views.set(view.id, view);
  // Registries union too — merged elements can otherwise reference domains
  // or definitions that exist only on the incoming side.
  const domains = new Map((current.domains ?? []).map((domain) => [domain.id, domain]));
  for (const domain of incoming.domains ?? []) domains.set(domain.id, domain);
  const artefacts = new Map((current.artefacts ?? []).map((artefact) => [artefact.id, artefact]));
  for (const artefact of incoming.artefacts ?? []) artefacts.set(artefact.id, artefact);
  const propertyDefinitions = new Map(
    current.propertyDefinitions.map((definition) => [definition.id, definition]),
  );
  for (const definition of incoming.propertyDefinitions) {
    propertyDefinitions.set(definition.id, definition);
  }

  const elementIds = new Set(elements.keys());
  const relationshipIds = new Set(relationships.keys());
  const cleanViews = [...views.values()].map((view) => {
    const nodes = view.nodes.filter((node) => !node.elementRef || elementIds.has(node.elementRef));
    const nodeIds = new Set(nodes.map((node) => node.id));
    const byElement = new Map<string, string>();
    for (const node of nodes) if (node.elementRef) byElement.set(node.elementRef, node.id);
    const edges = view.edges.flatMap((edge) => {
      if (
        !nodeIds.has(edge.source) ||
        !nodeIds.has(edge.target) ||
        !relationshipIds.has(edge.relationshipRef)
      ) {
        return [];
      }
      const relationship = relationships.get(edge.relationshipRef);
      if (!relationship) return [];
      // Edges whose relationship was replaced by the incoming model are
      // remapped to depict the new endpoints faithfully, mirroring the
      // reconnect semantics; when a view cannot depict it, the edge is
      // dropped rather than left lying about the model.
      const sourceNode = nodes.find((node) => node.id === edge.source);
      const targetNode = nodes.find((node) => node.id === edge.target);
      if (
        sourceNode?.elementRef === relationship.source &&
        targetNode?.elementRef === relationship.target
      ) {
        return [edge];
      }
      const newSource = byElement.get(relationship.source);
      const newTarget = byElement.get(relationship.target);
      if (!newSource || !newTarget) return [];
      return [{ ...edge, source: newSource, target: newTarget }];
    });
    // Children of pruned containers keep absolute bounds; promote to roots.
    const keptNodeIds = new Set(nodes.map((node) => node.id));
    const cleanNodes = nodes.map((node) =>
      node.parentId && !keptNodeIds.has(node.parentId) ? { ...node, parentId: undefined } : node,
    );
    return { ...view, nodes: cleanNodes, edges };
  });

  return {
    ...current,
    elements: [...elements.values()],
    relationships: [...relationships.values()],
    domains: [...domains.values()],
    artefacts: [...artefacts.values()],
    propertyDefinitions: [...propertyDefinitions.values()],
    views: cleanViews,
  };
}
