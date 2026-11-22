import { getElementType } from './metamodel';
import type { ElementKind, Layer, Model } from './types';

/** A viewpoint is a stakeholder-oriented selection of the same underlying model. */
export interface ViewpointDefinition {
  id: string;
  label: string;
  description: string;
  layers?: Layer[];
  kinds?: ElementKind[];
  elementTypes?: string[];
  relationshipTypes?: string[];
}

export const VIEWPOINTS: ViewpointDefinition[] = [
  { id: 'stakeholder', label: 'Stakeholder', description: 'Stakeholders, drivers, goals, and assessments.', elementTypes: ['Stakeholder', 'Driver', 'Assessment', 'Goal', 'Outcome', 'Value'] },
  { id: 'organization', label: 'Organization', description: 'Actors, roles, and organizational structure.', layers: ['business'], kinds: ['active', 'composite'] },
  { id: 'business-process', label: 'Business Process', description: 'Business processes and their relationships.', elementTypes: ['BusinessProcess', 'BusinessActor', 'BusinessRole', 'BusinessObject'] },
  { id: 'business-function', label: 'Business Function', description: 'Business functions and the units performing them.', elementTypes: ['BusinessFunction', 'BusinessActor', 'BusinessRole', 'BusinessComponent', 'BusinessCollaboration'] },
  { id: 'business-interaction', label: 'Business Interaction', description: 'Interactions between business roles and actors.', elementTypes: ['BusinessInteraction', 'BusinessActor', 'BusinessRole', 'BusinessInterface'] },
  { id: 'business-event', label: 'Business Event Processing', description: 'Events that trigger business behavior.', elementTypes: ['BusinessEvent', 'BusinessProcess', 'BusinessFunction', 'BusinessInteraction'] },
  { id: 'business-product', label: 'Business Product', description: 'Products and their composition.', elementTypes: ['Product', 'BusinessService', 'BusinessObject', 'Representation'] },
  { id: 'business-service', label: 'Business Service', description: 'Services offered to customers and partners.', elementTypes: ['BusinessService', 'BusinessRole', 'BusinessActor', 'BusinessInterface'] },
  { id: 'application-usage', label: 'Application Usage', description: 'Applications and the business functions they support.', layers: ['business', 'application'], kinds: ['active', 'behavior', 'passive'] },
  { id: 'application-cooperation', label: 'Application Cooperation', description: 'Application components and their interfaces.', layers: ['application'] },
  { id: 'application-structure', label: 'Application Structure', description: 'Internal structure of an application.', layers: ['application'], kinds: ['active', 'behavior', 'passive'] },
  { id: 'application-service', label: 'Application Service', description: 'Application services and their consumers.', elementTypes: ['ApplicationService', 'ApplicationInterface', 'ApplicationComponent', 'BusinessService', 'BusinessProcess'] },
  { id: 'technology', label: 'Technology', description: 'Technology elements supporting applications.', layers: ['technology'] },
  { id: 'infrastructure', label: 'Infrastructure', description: 'Nodes, devices, systems software, and networks.', elementTypes: ['Node', 'Device', 'SystemSoftware', 'Artifact', 'CommunicationNetwork'] },
  { id: 'physical', label: 'Physical', description: 'Facilities, equipment, and materials.', layers: ['physical'] },
  { id: 'information', label: 'Information', description: 'Business objects, data objects, and artifacts.', elementTypes: ['BusinessObject', 'DataObject', 'Artifact', 'Meaning', 'Representation'] },
  { id: 'motivation', label: 'Motivation', description: 'Why the architecture is what it is.', layers: ['motivation'] },
  { id: 'strategy', label: 'Strategy', description: 'Capabilities, resources, and courses of action.', layers: ['strategy'] },
  { id: 'capability', label: 'Capability', description: 'Organizational capabilities and their realization.', elementTypes: ['Capability', 'Resource', 'BusinessService', 'ApplicationService', 'CourseOfAction'] },
  { id: 'value-stream', label: 'Value Stream', description: 'How value flows to stakeholders.', elementTypes: ['ValueStream', 'Capability', 'BusinessProcess', 'BusinessEvent', 'Value', 'Outcome'] },
  { id: 'migration', label: 'Migration', description: 'Plateaus, gaps, and work packages.', layers: ['implementation'] },
  { id: 'landscape', label: 'Landscape', description: 'High-level overview across all layers.', kinds: ['active', 'composite'] },
  { id: 'all', label: 'All', description: 'Every element and relationship in the model.' },
];

const viewpointIndex = new Map(VIEWPOINTS.map((viewpoint) => [viewpoint.id, viewpoint]));

export function getViewpoint(id: string): ViewpointDefinition | undefined {
  return viewpointIndex.get(id);
}

function elementMatches(viewpoint: ViewpointDefinition, type: string, layer: string | undefined, kind: string | undefined): boolean {
  if (viewpoint.elementTypes) return viewpoint.elementTypes.includes(type);
  if (viewpoint.layers && (!layer || !viewpoint.layers.includes(layer as Layer))) return false;
  if (viewpoint.kinds && (!kind || !viewpoint.kinds.includes(kind as ElementKind))) return false;
  return true;
}

/** Produce a filtered copy of a model for a viewpoint. Original is untouched. */
export function filterModelByViewpoint(model: Model, viewpointId: string): Model {
  const viewpoint = getViewpoint(viewpointId);
  if (!viewpoint || viewpoint.id === 'all') return structuredClone(model);

  const elements = model.elements.filter((element) => {
    const definition = getElementType(element.type);
    return elementMatches(viewpoint, element.type, definition?.layer, definition?.kind);
  });
  const elementIds = new Set(elements.map((element) => element.id));

  const relationships = model.relationships.filter(
    (relationship) =>
      elementIds.has(relationship.source) &&
      elementIds.has(relationship.target) &&
      (!viewpoint.relationshipTypes || viewpoint.relationshipTypes.length === 0 || viewpoint.relationshipTypes.includes(relationship.type)),
  );
  const relationshipIds = new Set(relationships.map((relationship) => relationship.id));

  const views = model.views.map((view) => {
    const nodes = view.nodes.filter((node) => !node.elementRef || elementIds.has(node.elementRef));
    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges = view.edges.filter(
      (edge) =>
        nodeIds.has(edge.source) &&
        nodeIds.has(edge.target) &&
        relationshipIds.has(edge.relationshipRef),
    );
    // Children of pruned containers keep absolute bounds; promote them.
    const keptIds = new Set(nodes.map((node) => node.id));
    const cleanNodes = nodes.map((node) =>
      node.parentId && !keptIds.has(node.parentId) ? { ...node, parentId: undefined } : node,
    );
    return { ...view, nodes: cleanNodes, edges };
  });

  // Shallow copy sharing the original element objects: a read-only projection.
  // Mutating `elements` here does not mutate the source, but mutating an
  // element object would — callers must treat the result as read-only.
  return { ...structuredClone(model), elements, relationships, views };
}

// End of viewpoint definitions.
