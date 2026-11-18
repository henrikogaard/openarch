import { createModel, type ArchiElement, type Model, type Relationship, type View } from '@openarch/core';
import type { C4Element, C4Model, C4Relationship } from './types';

const KIND_TO_ARCHIMATE: Record<C4Element['kind'], string> = {
  person: 'BusinessActor',
  softwareSystem: 'ApplicationComponent',
  container: 'ApplicationComponent',
  component: 'ApplicationComponent',
};

/** Map a C4 relationship label onto an ArchiMate relationship type. */
export function c4RelationshipType(label: string): string {
  const normalized = label.toLowerCase();
  if (normalized.includes('access') || normalized.includes('read') || normalized.includes('write')) return 'Access';
  if (normalized.includes('uses') || normalized.includes('call')) return 'Serving';
  if (normalized.includes('contain')) return 'Composition';
  return 'Association';
}

function c4ElementToArchi(c4: C4Element, index: number): ArchiElement {
  const properties = [{ key: 'source', value: 'c4' }, { key: 'c4Kind', value: c4.kind }];
  if (c4.technology) properties.push({ key: 'technology', value: c4.technology });
  if (c4.tags) properties.push({ key: 'tags', value: c4.tags });
  return {
    id: `c4-${c4.id}`,
    type: KIND_TO_ARCHIMATE[c4.kind],
    name: [{ lang: 'en', value: c4.name || c4.id }],
    documentation: c4.description ? [{ lang: 'en', value: c4.description }] : [],
    properties,
    // Containers/components land on the technology layer visually via type only;
    // keep application layer for systems/containers, technology for components is
    // overkill — grouping is expressed by the C4 views.
    ...(c4.kind === 'person' ? {} : {}),
  };
}

function c4RelationshipToArchi(rel: C4Relationship, elementIds: Map<string, string>): Relationship | null {
  const source = elementIds.get(rel.source);
  const target = elementIds.get(rel.target);
  if (!source || !target || source === target) return null;
  return {
    id: `c4rel-${rel.source}-${rel.target}`,
    type: c4RelationshipType(rel.label),
    source,
    target,
    name: rel.label ? [{ lang: 'en', value: rel.label }] : [],
    documentation: [],
    properties: rel.technology ? [{ key: 'technology', value: rel.technology }] : [],
  };
}

function gridPosition(index: number): { x: number; y: number } {
  return { x: 60 + (index % 4) * 220, y: 80 + Math.floor(index / 4) * 140 };
}

/** Convert a parsed C4 model into an OpenArch model: one ArchiMate view per C4 view. */
export function c4ToModel(c4: C4Model): Model {
  const elements = c4.elements.map((element, index) => c4ElementToArchi(element, index));
  const elementIds = new Map(c4.elements.map((element, index) => [element.id, elements[index].id]));
  const relationships = c4.relationships
    .map((rel) => c4RelationshipToArchi(rel, elementIds))
    .filter((rel): rel is Relationship => Boolean(rel));

  const views: View[] = c4.views.map((view, viewIndex) => {
    const nodes = view.elements
      .map((id, index) => {
        const elementId = elementIds.get(id);
        if (!elementId) return null;
        const position = gridPosition(index);
        return {
          id: `c4node-${view.key}-${id}`,
          type: 'Element' as const,
          elementRef: elementId,
          label: [],
          bounds: { ...position, w: 170, h: 64 },
        };
      })
      .filter((node) => node !== null);
    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges = view.relationships
      .map((rel, index) => {
        const sourceId = elementIds.get(rel.source);
        const targetId = elementIds.get(rel.target);
        if (!sourceId || !targetId) return null;
        const sourceNode = nodes.find((node) => node.elementRef === sourceId);
        const targetNode = nodes.find((node) => node.elementRef === targetId);
        if (!sourceNode || !targetNode) return null;
        const relationship = relationships.find(
          (candidate) => candidate.source === sourceId && candidate.target === targetId,
        );
        if (!relationship) return null;
        return {
          id: `c4edge-${view.key}-${index}`,
          type: 'Relationship' as const,
          relationshipRef: relationship.id,
          source: sourceNode.id,
          target: targetNode.id,
          bendpoints: [],
        };
      })
      .filter((edge) => edge !== null);
    void nodeIds;
    return {
      id: `c4view-${view.key}`,
      type: 'Diagram',
      name: [{ lang: 'en', value: `${c4.name} — ${view.key}` }],
      nodes,
      edges,
    };
  });

  if (views.length === 0) {
    views.push({
      id: 'c4view-context',
      type: 'Diagram',
      name: [{ lang: 'en', value: `${c4.name} — context` }],
      nodes: elements.map((element, index) => ({
        id: `c4node-context-${element.id}`,
        type: 'Element' as const,
        elementRef: element.id,
        label: [],
        bounds: { ...gridPosition(index), w: 170, h: 64 },
      })),
      edges: relationships.map((relationship, index) => {
        const sourceNode = elements.find((element) => element.id === relationship.source);
        const targetNode = elements.find((element) => element.id === relationship.target);
        const source = `c4node-context-${sourceNode?.id}`;
        const target = `c4node-context-${targetNode?.id}`;
        return {
          id: `c4edge-context-${index}`,
          type: 'Relationship' as const,
          relationshipRef: relationship.id,
          source,
          target,
          bendpoints: [],
        };
      }),
    });
  }

  return createModel({
    id: `c4-${camel(c4.name)}`,
    name: [{ lang: 'en', value: c4.name }],
    documentation: c4.description ? [{ lang: 'en', value: c4.description }] : [],
    elements,
    relationships,
    views,
  });
}

function camel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workspace';
}
