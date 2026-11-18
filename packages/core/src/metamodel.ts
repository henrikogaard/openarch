import type {
  ElementKind,
  ElementTypeDefinition,
  Layer,
  RelationshipTypeDefinition,
} from './types';

/**
 * ArchiMate® 3.2 metamodel registry.
 *
 * The registry is intentionally data-driven: viewpoints, the palette, the magic
 * connector, validation, and exporters all read from these definitions. A 4.0
 * registry can be added later without touching consumers.
 */
export const METAMODEL_VERSION = '3.2';

/** A versioned metamodel: element and relationship type tables for one ArchiMate version. */
export interface MetamodelRegistry {
  version: string;
  elementTypes: ElementTypeDefinition[];
  relationshipTypes: RelationshipTypeDefinition[];
}

const metamodelRegistries = new Map<string, MetamodelRegistry>();

/** Register a metamodel version (e.g. a future 4.0) alongside 3.2. Idempotent per version. */
export function registerMetamodelVersion(
  version: string,
  registry: Omit<MetamodelRegistry, 'version'>,
): void {
  if (!metamodelRegistries.has(version)) {
    metamodelRegistries.set(version, { version, ...registry });
  }
}

/** The registry for a version, falling back to the default (3.2). */
export function getMetamodel(version: string = METAMODEL_VERSION): MetamodelRegistry {
  return metamodelRegistries.get(version) ?? metamodelRegistries.get(METAMODEL_VERSION)!;
}

export function metamodelVersions(): string[] {
  return [...metamodelRegistries.keys()];
}

export const LAYER_COLORS: Record<Layer, string> = {
  business: '#f7dc6f',
  application: '#8ec3e8',
  technology: '#a9d8a9',
  motivation: '#f0d5dc',
  strategy: '#c9b3e0',
  physical: '#e8c39e',
  implementation: '#c8e0d4',
  other: '#e2e2e2',
};

const LAYER_LETTERS: Record<Layer, string> = {
  business: 'B',
  application: 'A',
  technology: 'T',
  motivation: 'M',
  strategy: 'S',
  physical: 'P',
  implementation: 'I',
  other: 'O',
};

export const LAYER_LABELS: Record<Layer, string> = {
  business: 'Business',
  application: 'Application',
  technology: 'Technology',
  motivation: 'Motivation',
  strategy: 'Strategy',
  physical: 'Physical',
  implementation: 'Implementation & Migration',
  other: 'Other',
};

export const LAYER_ORDER: Layer[] = [
  'strategy',
  'business',
  'application',
  'technology',
  'physical',
  'motivation',
  'implementation',
  'other',
];

type Shape = ElementTypeDefinition['shape'];
type ElementSpec = [id: string, label: string, layer: Layer, kind: ElementKind, shape: Shape, icon: string];

/** 59 ArchiMate 3.2 element types across layers, aspects, and extensions. */
const ELEMENT_SPECS: ElementSpec[] = [
  // Strategy
  ['Resource', 'Resource', 'strategy', 'active', 'square', 'R'],
  ['Capability', 'Capability', 'strategy', 'active', 'square', 'C'],
  ['CourseOfAction', 'Course of Action', 'strategy', 'behavior', 'rounded', 'CoA'],
  ['ValueStream', 'Value Stream', 'strategy', 'behavior', 'rounded', 'VS'],

  // Business — active structure
  ['BusinessActor', 'Business Actor', 'business', 'active', 'square', 'BA'],
  ['BusinessRole', 'Business Role', 'business', 'active', 'square', 'BR'],
  ['BusinessCollaboration', 'Business Collaboration', 'business', 'active', 'square', 'BC'],
  ['BusinessComponent', 'Business Component', 'business', 'active', 'square', 'BC'],
  ['BusinessInterface', 'Business Interface', 'business', 'active', 'square', 'BI'],
  // Business — behavior
  ['BusinessProcess', 'Business Process', 'business', 'behavior', 'rounded', 'BP'],
  ['BusinessFunction', 'Business Function', 'business', 'behavior', 'rounded', 'BF'],
  ['BusinessService', 'Business Service', 'business', 'behavior', 'rounded', 'BS'],
  ['BusinessEvent', 'Business Event', 'business', 'behavior', 'rounded', 'BE'],
  ['BusinessInteraction', 'Business Interaction', 'business', 'behavior', 'rounded', 'BI'],
  // Business — passive structure / composite
  ['BusinessObject', 'Business Object', 'business', 'passive', 'square', 'BO'],
  ['Product', 'Product', 'business', 'composite', 'square', 'P'],
  ['Contract', 'Contract', 'business', 'composite', 'square', 'Ct'],
  ['Representation', 'Representation', 'business', 'composite', 'square', 'Rp'],

  // Application — active structure
  ['ApplicationComponent', 'Application Component', 'application', 'active', 'square', 'AC'],
  ['ApplicationCollaboration', 'Application Collaboration', 'application', 'active', 'square', 'ACo'],
  ['ApplicationInterface', 'Application Interface', 'application', 'active', 'square', 'AI'],
  // Application — behavior
  ['ApplicationProcess', 'Application Process', 'application', 'behavior', 'rounded', 'AP'],
  ['ApplicationFunction', 'Application Function', 'application', 'behavior', 'rounded', 'AF'],
  ['ApplicationService', 'Application Service', 'application', 'behavior', 'rounded', 'AS'],
  ['ApplicationEvent', 'Application Event', 'application', 'behavior', 'rounded', 'AE'],
  ['ApplicationInteraction', 'Application Interaction', 'application', 'behavior', 'rounded', 'AI'],
  // Application — passive structure
  ['DataObject', 'Data Object', 'application', 'passive', 'square', 'DO'],

  // Technology — active structure
  ['Node', 'Node', 'technology', 'active', 'square', 'N'],
  ['Device', 'Device', 'technology', 'active', 'square', 'D'],
  ['SystemSoftware', 'System Software', 'technology', 'active', 'square', 'SS'],
  ['TechnologyCollaboration', 'Technology Collaboration', 'technology', 'active', 'square', 'TC'],
  ['TechnologyInterface', 'Technology Interface', 'technology', 'active', 'square', 'TI'],
  ['Path', 'Path', 'technology', 'active', 'square', 'Pa'],
  ['CommunicationNetwork', 'Communication Network', 'technology', 'active', 'square', 'CN'],
  // Technology — behavior
  ['TechnologyProcess', 'Technology Process', 'technology', 'behavior', 'rounded', 'TP'],
  ['TechnologyFunction', 'Technology Function', 'technology', 'behavior', 'rounded', 'TF'],
  ['TechnologyService', 'Technology Service', 'technology', 'behavior', 'rounded', 'TS'],
  ['TechnologyEvent', 'Technology Event', 'technology', 'behavior', 'rounded', 'TE'],
  ['TechnologyInteraction', 'Technology Interaction', 'technology', 'behavior', 'rounded', 'TI'],
  // Technology — passive structure
  ['Artifact', 'Artifact', 'technology', 'passive', 'square', 'Ar'],

  // Physical (ArchiMate 3.2)
  ['Facility', 'Facility', 'physical', 'active', 'square', 'F'],
  ['Equipment', 'Equipment', 'physical', 'active', 'square', 'E'],
  ['Material', 'Material', 'physical', 'passive', 'square', 'Ma'],
  ['DistributionNetwork', 'Distribution Network', 'physical', 'passive', 'square', 'DN'],

  // Motivation
  ['Stakeholder', 'Stakeholder', 'motivation', 'motivation', 'diagonal', 'St'],
  ['Driver', 'Driver', 'motivation', 'motivation', 'diagonal', 'Dr'],
  ['Assessment', 'Assessment', 'motivation', 'motivation', 'diagonal', 'As'],
  ['Goal', 'Goal', 'motivation', 'motivation', 'diagonal', 'G'],
  ['Outcome', 'Outcome', 'motivation', 'motivation', 'diagonal', 'O'],
  ['Principle', 'Principle', 'motivation', 'motivation', 'diagonal', 'Pr'],
  ['Requirement', 'Requirement', 'motivation', 'motivation', 'diagonal', 'Req'],
  ['Constraint', 'Constraint', 'motivation', 'motivation', 'diagonal', 'Con'],
  ['Meaning', 'Meaning', 'motivation', 'motivation', 'diagonal', 'Me'],
  ['Value', 'Value', 'motivation', 'motivation', 'diagonal', 'V'],

  // Implementation & Migration
  ['WorkPackage', 'Work Package', 'implementation', 'active', 'square', 'WP'],
  ['Deliverable', 'Deliverable', 'implementation', 'passive', 'square', 'Del'],
  ['Plateau', 'Plateau', 'implementation', 'composite', 'square', 'Pl'],
  ['Gap', 'Gap', 'implementation', 'composite', 'square', 'Ga'],
  ['ImplementationEvent', 'Implementation Event', 'implementation', 'behavior', 'rounded', 'IE'],
  ['MigrationEvent', 'Migration Event', 'implementation', 'behavior', 'rounded', 'ME'],

  // Other / composite
  ['Location', 'Location', 'other', 'composite', 'square', 'Loc'],
  ['Grouping', 'Grouping', 'other', 'composite', 'square', 'Gr'],
  ['AndJunction', 'And Junction', 'other', 'composite', 'square', 'AJ'],
  ['OrJunction', 'Or Junction', 'other', 'composite', 'square', 'OJ'],
];

export const ELEMENT_TYPES: ElementTypeDefinition[] = ELEMENT_SPECS.map(
  ([id, label, layer, kind, shape, icon]) => ({
    id,
    label,
    layer,
    kind,
    shape,
    icon,
    letter: LAYER_LETTERS[layer],
    color: LAYER_COLORS[layer],
  }),
);

export type RelationshipGroup = 'structural' | 'dependency' | 'dynamic' | 'other';

type RelationshipSpec = {
  id: string;
  label: string;
  group: RelationshipGroup;
  sourceKinds: ElementKind[];
  targetKinds: ElementKind[];
  lineStyle: 'solid' | 'dashed';
  arrow: 'open' | 'filled' | 'none';
  requiresSameLayer?: boolean;
  requiresSameKind?: boolean;
  description: string;
};

const ALL_KINDS: ElementKind[] = [
  'active',
  'behavior',
  'passive',
  'motivation',
  'strategy',
  'composite',
];

/** The 12 core ArchiMate relationships with pragmatic allowed-combination rules. */
export const RELATIONSHIP_TYPES: RelationshipTypeDefinition[] = [
  {
    id: 'Composition',
    label: 'Composition',
    group: 'structural',
    description: 'An element consists of one or more other elements.',
    sourceKinds: ALL_KINDS,
    targetKinds: ALL_KINDS,
    lineStyle: 'solid',
    arrow: 'filled',
  },
  {
    id: 'Aggregation',
    label: 'Aggregation',
    group: 'structural',
    description: 'An element groups other elements without owning them.',
    sourceKinds: ALL_KINDS,
    targetKinds: ALL_KINDS,
    lineStyle: 'solid',
    arrow: 'open',
  },
  {
    id: 'Assignment',
    label: 'Assignment',
    group: 'structural',
    description: 'Assigns behavior to a structure element, or a role to an actor.',
    sourceKinds: ['active', 'strategy', 'composite'],
    targetKinds: ['behavior', 'passive', 'strategy', 'composite'],
    lineStyle: 'solid',
    arrow: 'filled',
  },
  {
    id: 'Realization',
    label: 'Realization',
    group: 'dependency',
    description: 'A concrete element implements a more abstract one.',
    sourceKinds: ALL_KINDS,
    targetKinds: ALL_KINDS,
    lineStyle: 'dashed',
    arrow: 'open',
  },
  {
    id: 'Serving',
    label: 'Serving',
    group: 'dependency',
    description: 'One element provides functionality to another.',
    sourceKinds: ['behavior', 'active'],
    targetKinds: ALL_KINDS,
    lineStyle: 'solid',
    arrow: 'open',
  },
  {
    id: 'Access',
    label: 'Access',
    group: 'dependency',
    description: 'Behavior or active structure reads, writes, or creates passive structure.',
    sourceKinds: ['active', 'behavior', 'composite'],
    targetKinds: ['passive', 'composite'],
    lineStyle: 'solid',
    arrow: 'filled',
  },
  {
    id: 'Influence',
    label: 'Influence',
    group: 'dependency',
    description: 'A motivation or strategy element affects another element.',
    sourceKinds: ['motivation', 'strategy', 'composite'],
    targetKinds: ALL_KINDS,
    lineStyle: 'dashed',
    arrow: 'open',
  },
  {
    id: 'Triggering',
    label: 'Triggering',
    group: 'dynamic',
    description: 'One behavior element causes another to occur.',
    sourceKinds: ['behavior'],
    targetKinds: ['behavior'],
    lineStyle: 'solid',
    arrow: 'filled',
  },
  {
    id: 'Flow',
    label: 'Flow',
    group: 'dynamic',
    description: 'Data or products flow from one element to another.',
    sourceKinds: ['passive', 'behavior', 'composite'],
    targetKinds: ['passive', 'behavior', 'composite'],
    lineStyle: 'solid',
    arrow: 'open',
  },
  {
    id: 'Association',
    label: 'Association',
    group: 'other',
    description: 'An unspecified relationship between elements.',
    sourceKinds: ALL_KINDS,
    targetKinds: ALL_KINDS,
    lineStyle: 'dashed',
    arrow: 'none',
  },
  {
    id: 'Specialization',
    label: 'Specialization',
    group: 'other',
    description: 'A more specific element derives from a more general one.',
    sourceKinds: ALL_KINDS,
    targetKinds: ALL_KINDS,
    lineStyle: 'solid',
    arrow: 'open',
    requiresSameKind: true,
  },
];

const elementTypeIndex = new Map(ELEMENT_TYPES.map((type) => [type.id, type]));
const relationshipTypeIndex = new Map(RELATIONSHIP_TYPES.map((type) => [type.id, type]));

// The default registry is 3.2; other versions register themselves here.
registerMetamodelVersion(METAMODEL_VERSION, {
  elementTypes: ELEMENT_TYPES,
  relationshipTypes: RELATIONSHIP_TYPES,
});

export function getElementType(id: string): ElementTypeDefinition | undefined {
  return elementTypeIndex.get(id);
}

export function getRelationshipType(id: string): RelationshipTypeDefinition | undefined {
  return relationshipTypeIndex.get(id);
}

export function elementKind(typeId: string): ElementKind | undefined {
  return getElementType(typeId)?.kind;
}

export function elementLayer(typeId: string): Layer | undefined {
  return getElementType(typeId)?.layer;
}

/** Relationship types that are meaningful for the given source/target types. */
export function allowedRelationships(
  sourceType: string,
  targetType: string,
): RelationshipTypeDefinition[] {
  const source = getElementType(sourceType);
  const target = getElementType(targetType);
  if (!source || !target) return [];
  return RELATIONSHIP_TYPES.filter((relationship) => {
    if (!relationship.sourceKinds.includes(source.kind)) return false;
    if (!relationship.targetKinds.includes(target.kind)) return false;
    if (relationship.requiresSameLayer && source.layer !== target.layer) return false;
    if (relationship.requiresSameKind && source.kind !== target.kind) return false;
    return true;
  });
}

export function isAllowedRelationship(
  type: string,
  sourceType: string,
  targetType: string,
): boolean {
  return allowedRelationships(sourceType, targetType).some((relationship) => relationship.id === type);
}

/** Elements grouped for the palette and search. */
export function elementsByLayer(): Array<{ layer: Layer; types: ElementTypeDefinition[] }> {
  return LAYER_ORDER.map((layer) => ({
    layer,
    types: ELEMENT_TYPES.filter((type) => type.layer === layer),
  }));
}

export function relationshipGroups(): Array<{ group: RelationshipGroup; types: RelationshipTypeDefinition[] }> {
  const groups: RelationshipGroup[] = ['structural', 'dependency', 'dynamic', 'other'];
  return groups.map((group) => ({
    group,
    types: RELATIONSHIP_TYPES.filter((type) => type.group === group),
  }));
}
