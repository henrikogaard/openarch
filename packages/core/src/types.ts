/** Canonical model types shared by the editor, repository, and analysis layers. */

export interface LocalizedText {
  lang?: string;
  value: string;
}

/** Untouched parsed XML fragment, kept so AOEF round-trips preserve unknown data. */
export type RawXml = Record<string, any>;

export type Layer =
  | 'business'
  | 'application'
  | 'technology'
  | 'motivation'
  | 'strategy'
  | 'physical'
  | 'implementation'
  | 'other';

export type ElementKind =
  | 'active'
  | 'behavior'
  | 'passive'
  | 'motivation'
  | 'strategy'
  | 'composite';

export interface ElementTypeDefinition {
  /** The AOEF xsi:type value, e.g. "BusinessActor". */
  id: string;
  label: string;
  layer: Layer;
  kind: ElementKind;
  /** Top-left notation badge. */
  letter: string;
  /** Short glyph shown in the top-right corner of the notation. */
  icon?: string;
  /** Fill color used by both the canvas and exports. */
  color: string;
  shape: 'square' | 'rounded' | 'diagonal';
}

export interface RelationshipTypeDefinition {
  id: string;
  label: string;
  description: string;
  group?: 'structural' | 'dependency' | 'dynamic' | 'other';
  sourceKinds: ElementKind[];
  targetKinds: ElementKind[];
  lineStyle: 'solid' | 'dashed';
  arrow: 'open' | 'filled' | 'none';
  requiresSameLayer?: boolean;
  requiresSameKind?: boolean;
}

export interface Property {
  key: string;
  value: string;
  definitionRef?: string;
  raw?: RawXml;
}

export interface PropertyDefinition {
  id: string;
  name: string;
  type: string;
  raw?: RawXml;
}

export interface ArchiElement {
  id: string;
  type: string;
  name: LocalizedText[];
  documentation: LocalizedText[];
  properties: Property[];
  /** Domain id this element belongs to (a partition of the same model). */
  domain?: string;
  /** Deployment environment: dev, staging, prod, or a custom value. */
  environment?: string;
  raw?: RawXml;
}

export interface Relationship {
  id: string;
  type: string;
  source: string;
  target: string;
  name: LocalizedText[];
  documentation: LocalizedText[];
  properties: Property[];
  accessType?: string;
  raw?: RawXml;
}

export interface Point {
  x: number;
  y: number;
}

export interface Bounds extends Point {
  w: number;
  h: number;
}

export interface ViewNode {
  id: string;
  /** AOEF xsi:type of the view node, e.g. "Element", "Label", "Group". */
  type: string;
  elementRef?: string;
  viewRef?: string;
  label: LocalizedText[];
  bounds: Bounds;
  /** Native-only: parent container node id (RF nesting). Not exported to AOEF. */
  parentId?: string;
  /** Native-only: stacking order within the view. Not exported to AOEF. */
  zIndex?: number;
  raw?: RawXml;
}

export interface ViewEdge {
  id: string;
  type: string;
  relationshipRef: string;
  source: string;
  target: string;
  bendpoints: Point[];
  raw?: RawXml;
}

export type GranulationLevel = 'L1' | 'L2' | 'L3' | 'L4';

/**
 * A generated view keeps its recipe so it can be regenerated when the model
 * changes. Views without a config are hand-drawn.
 */
export interface ViewConfig {
  viewpointId: string;
  granulation: GranulationLevel;
  elementTypes: string[];
  relationshipTypes: string[];
  /** Built-ins (type, domain, environment) or property keys (version, ip, owner). */
  attributes: string[];
  groupBy: 'none' | 'domain' | 'layer';
  domainFilter?: string;
  environmentFilter?: string;
  /** Dependency neighbourhood depth from the root elements. */
  depth: number;
  rootElementIds?: string[];
  /** Elements to expand with their lower-level detail (e.g. servers behind an app). */
  expandElementIds?: string[];
}

export interface View {
  id: string;
  type: string;
  name: LocalizedText[];
  nodes: ViewNode[];
  edges: ViewEdge[];
  config?: ViewConfig;
  raw?: RawXml;
}

export type ModelPurpose = 'as-is' | 'to-be' | 'migration';
export type WorkspaceStatus = 'draft' | 'active' | 'approved' | 'archived';

/** A named area of the architecture inside a workspace (e.g. Payments, Customer). */
export interface Domain {
  id: string;
  name: string;
  description?: string;
  owner?: string;
  color?: string;
  parentId?: string;
}

export type ArtefactKind = 'adr' | 'requirement' | 'principle' | 'assessment';

/** A document that lives next to the model: decision record, requirement, assessment. */
export interface Artefact {
  id: string;
  kind: ArtefactKind;
  title: string;
  body: string;
  status: string;
  elementIds: string[];
  author?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Approval {
  id: string;
  baselineId: string;
  actor: string;
  decision: 'approved' | 'rejected';
  comment?: string;
  createdAt: string;
}

export interface Model {
  id: string;
  name: LocalizedText[];
  documentation: LocalizedText[];
  properties: Property[];
  propertyDefinitions: PropertyDefinition[];
  elements: ArchiElement[];
  relationships: Relationship[];
  views: View[];
  /** Modelling intent, shown as a badge in the workspace list. */
  purpose?: ModelPurpose;
  /** Lifecycle state of the workspace. */
  status?: WorkspaceStatus;
  /** Accountable person for the workspace. */
  owner?: string;
  tags?: string[];
  domains?: Domain[];
  artefacts?: Artefact[];
  approvals?: Approval[];
  /** ISO timestamp of the last save; stamped by the repository. */
  updatedAt?: string;
  createdAt?: string;
  raw?: RawXml;
}

export interface ModelSummary {
  id: string;
  name: string;
  description: string;
  purpose: ModelPurpose;
  status: WorkspaceStatus;
  owner: string;
  tags: string[];
  elementCount: number;
  relationshipCount: number;
  viewCount: number;
  domainCount: number;
  artefactCount: number;
  createdAt?: string;
  updatedAt?: string;
}

export function primaryText(values: LocalizedText[]): string {
  return values[0]?.value ?? '';
}

export interface Comment {
  id: string;
  modelId: string;
  elementId?: string;
  author: string;
  body: string;
  createdAt: string;
  resolved: boolean;
}

export interface AuditEvent {
  id: string;
  modelId: string;
  actor: string;
  action: 'create' | 'update' | 'delete' | 'import' | 'comment' | 'restore';
  entityId?: string;
  summary: string;
  createdAt: string;
}

/** A bookmarked UI state (tab, filters, active view) for repeat analysis. */
export interface SavedView {
  id: string;
  name: string;
  modelId: string;
  kind: string;
  filters: Record<string, unknown>;
  createdAt: string;
}

export type WorkspaceRole = 'owner' | 'editor' | 'viewer';

export interface WorkspaceMember {
  subject: string;
  role: WorkspaceRole;
  displayName?: string;
}

export interface ModelEnvelope {
  model: Model;
  version: number;
  updatedAt: string;
  updatedBy: string;
}

export function createModel(partial: Partial<Model> = {}): Model {
  return {
    id: partial.id ?? `model-${crypto.randomUUID()}`,
    name: partial.name ?? [{ lang: 'en', value: 'Untitled model' }],
    documentation: partial.documentation ?? [],
    properties: partial.properties ?? [],
    propertyDefinitions: partial.propertyDefinitions ?? [],
    elements: partial.elements ?? [],
    relationships: partial.relationships ?? [],
    views: partial.views ?? [],
    purpose: partial.purpose ?? 'as-is',
    status: partial.status ?? 'draft',
    owner: partial.owner ?? '',
    tags: partial.tags ?? [],
    domains: partial.domains ?? [],
    artefacts: partial.artefacts ?? [],
    approvals: partial.approvals ?? [],
    createdAt: partial.createdAt ?? new Date().toISOString(),
    updatedAt: partial.updatedAt,
    raw: partial.raw,
  };
}
