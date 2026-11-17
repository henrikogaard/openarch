import { getElementType } from './metamodel';
import type {
  ArchiElement,
  Artefact,
  ArtefactKind,
  Domain,
  Model,
  ModelSummary,
  Point,
  WorkspaceStatus,
} from './types';
import { primaryText } from './types';
import type { ValidationIssue } from './validation';

export const WORKSPACE_STATUSES: WorkspaceStatus[] = ['draft', 'active', 'approved', 'archived'];

export const DOMAIN_COLORS = [
  '#2563eb',
  '#0891b2',
  '#7c3aed',
  '#db2777',
  '#ea580c',
  '#16a34a',
  '#ca8a04',
  '#475569',
];

export const ENVIRONMENTS = ['dev', 'staging', 'prod'] as const;

export const ARTEFACT_KINDS: ArtefactKind[] = ['adr', 'requirement', 'principle', 'assessment'];

export function createDomain(name: string, options: Partial<Domain> = {}): Domain {
  return {
    id: options.id ?? `domain-${slug(name)}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    description: options.description,
    owner: options.owner,
    color: options.color ?? DOMAIN_COLORS[Math.floor(Math.random() * DOMAIN_COLORS.length)],
    parentId: options.parentId,
  };
}

export function createArtefact(
  kind: ArtefactKind,
  title: string,
  body = '',
  options: Partial<Artefact> = {},
): Artefact {
  const now = new Date().toISOString();
  return {
    id: options.id ?? `artefact-${crypto.randomUUID()}`,
    kind,
    title,
    body,
    status: options.status ?? (kind === 'adr' ? 'proposed' : 'open'),
    elementIds: options.elementIds ?? [],
    author: options.author,
    createdAt: options.createdAt ?? now,
    updatedAt: options.updatedAt ?? now,
  };
}

export function domainById(model: Model, id: string | undefined): Domain | undefined {
  if (!id) return undefined;
  return (model.domains ?? []).find((domain) => domain.id === id);
}

export function elementsInDomain(model: Model, domainId: string): Model['elements'] {
  return model.elements.filter((element) => element.domain === domainId);
}

/** Filter a model to one domain (or all). Views are pruned to surviving elements. */
export function filterModelByDomain(model: Model, domainId: string | 'all'): Model {
  if (domainId === 'all') return model;
  const elements = model.elements.filter((element) => element.domain === domainId);
  const ids = new Set(elements.map((element) => element.id));
  const relationships = model.relationships.filter(
    (relationship) => ids.has(relationship.source) && ids.has(relationship.target),
  );
  const relationshipIds = new Set(relationships.map((relationship) => relationship.id));
  const views = model.views.map((view) => {
    const nodes = view.nodes.filter((node) => !node.elementRef || ids.has(node.elementRef));
    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges = view.edges.filter(
      (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target) && relationshipIds.has(edge.relationshipRef),
    );
    return { ...view, nodes, edges };
  });
  return { ...model, elements, relationships, views };
}

/** Resolve view node ids to the elements they show (label/group nodes are skipped). */
export function elementRefsForNodes(model: Model, nodeIds: string[]): string[] {
  const ids = new Set(nodeIds);
  const refs = new Set<string>();
  for (const view of model.views) {
    for (const node of view.nodes) {
      if (ids.has(node.id) && node.elementRef) refs.add(node.elementRef);
    }
  }
  return [...refs];
}

/** Resolve view edge ids to the relationships they show. */
export function relationshipRefsForEdges(model: Model, edgeIds: string[]): string[] {
  const ids = new Set(edgeIds);
  const refs = new Set<string>();
  for (const view of model.views) {
    for (const edge of view.edges) {
      if (ids.has(edge.id)) refs.add(edge.relationshipRef);
    }
  }
  return [...refs];
}

/**
 * Delete elements from the canonical model: the elements themselves, every
 * relationship that touches them, all view nodes/edges that referenced them,
 * and artefact links to them. Keeps validation free of dangling references.
 */
export function removeElements(model: Model, elementIds: string[]): Model {
  const ids = new Set(elementIds);
  if (!model.elements.some((element) => ids.has(element.id))) return model;
  const elements = model.elements.filter((element) => !ids.has(element.id));
  const relationships = model.relationships.filter(
    (relationship) => !ids.has(relationship.source) && !ids.has(relationship.target),
  );
  const relationshipIds = new Set(relationships.map((relationship) => relationship.id));
  const views = model.views.map((view) => {
    const nodes = view.nodes.filter((node) => !node.elementRef || !ids.has(node.elementRef));
    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges = view.edges.filter(
      (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target) && relationshipIds.has(edge.relationshipRef),
    );
    return { ...view, nodes, edges };
  });
  const artefacts = (model.artefacts ?? []).map((artefact) => ({
    ...artefact,
    elementIds: artefact.elementIds.filter((id) => !ids.has(id)),
  }));
  return { ...model, elements, relationships, views, artefacts };
}

/** Delete relationships and every view edge that showed them. */
export function removeRelationships(model: Model, relationshipIds: string[]): Model {
  const ids = new Set(relationshipIds);
  if (!model.relationships.some((relationship) => ids.has(relationship.id))) return model;
  const relationships = model.relationships.filter((relationship) => !ids.has(relationship.id));
  const views = model.views.map((view) => ({
    ...view,
    edges: view.edges.filter((edge) => !ids.has(edge.relationshipRef)),
  }));
  return { ...model, relationships, views };
}

/** Bulk-assign a patch (e.g. domain/environment) to many elements at once. */
export function assignElements(
  model: Model,
  elementIds: string[],
  patch: Partial<Pick<ArchiElement, 'domain' | 'environment'>>,
): Model {
  const ids = new Set(elementIds);
  if (!model.elements.some((element) => ids.has(element.id))) return model;
  return {
    ...model,
    elements: model.elements.map((element) => (ids.has(element.id) ? { ...element, ...patch } : element)),
  };
}

/**
 * Duplicate a set of elements as a subgraph: the elements, the relationships
 * whose endpoints are both in the set, and their nodes/edges in the given view
 * (shifted by `offset`). New ids throughout; the input model is untouched.
 */
export function duplicateElements(
  model: Model,
  elementIds: string[],
  viewId: string,
  offset: Point = { x: 40, y: 40 },
): Model {
  const ids = new Set(elementIds);
  const selected = model.elements.filter((element) => ids.has(element.id));
  if (!selected.length) return model;

  const elementIdMap = new Map(selected.map((element) => [element.id, `el-${crypto.randomUUID()}`]));
  const newElements: ArchiElement[] = selected.map((element) => ({
    ...element,
    id: elementIdMap.get(element.id)!,
    name: element.name.map((text) => ({ ...text, value: `${text.value} (copy)` })),
    properties: element.properties.map((property) => ({ ...property })),
  }));

  const relationshipIdMap = new Map<string, string>();
  const newRelationships = model.relationships
    .filter((relationship) => ids.has(relationship.source) && ids.has(relationship.target))
    .map((relationship) => {
      const id = `rel-${crypto.randomUUID()}`;
      relationshipIdMap.set(relationship.id, id);
      return {
        ...relationship,
        id,
        source: elementIdMap.get(relationship.source)!,
        target: elementIdMap.get(relationship.target)!,
        name: relationship.name.map((text) => ({ ...text })),
        properties: relationship.properties.map((property) => ({ ...property })),
      };
    });

  const views = model.views.map((view) => {
    if (view.id !== viewId) return view;
    const nodeIdMap = new Map<string, string>();
    const addedNodes = view.nodes
      .filter((node) => node.elementRef && ids.has(node.elementRef))
      .map((node) => {
        const id = `node-${crypto.randomUUID()}`;
        nodeIdMap.set(node.id, id);
        return {
          ...node,
          id,
          elementRef: elementIdMap.get(node.elementRef!)!,
          label: node.label.map((text) => ({ ...text })),
          bounds: {
            x: node.bounds.x + offset.x,
            y: node.bounds.y + offset.y,
            w: node.bounds.w,
            h: node.bounds.h,
          },
        };
      });
    const addedEdges = view.edges
      .filter((edge) => nodeIdMap.has(edge.source) && nodeIdMap.has(edge.target))
      .map((edge) => ({
        ...edge,
        id: `edge-${crypto.randomUUID()}`,
        relationshipRef: relationshipIdMap.get(edge.relationshipRef)!,
        source: nodeIdMap.get(edge.source)!,
        target: nodeIdMap.get(edge.target)!,
        bendpoints: edge.bendpoints.map((point) => ({ ...point })),
      }));
    return { ...view, nodes: [...view.nodes, ...addedNodes], edges: [...view.edges, ...addedEdges] };
  });

  return {
    ...model,
    elements: [...model.elements, ...newElements],
    relationships: [...model.relationships, ...newRelationships],
    views,
  };
}

export interface DomainStat {
  domain: Domain;
  elementCount: number;
  relationshipCount: number;
  crossDomainCount: number;
}

/** Per-domain element counts plus the number of relationships that cross a domain boundary. */
export function domainStats(model: Model): DomainStat[] {
  const domains = model.domains ?? [];
  const domainOf = new Map(model.elements.map((element) => [element.id, element.domain ?? '']));
  return domains.map((domain) => {
    const elementCount = model.elements.filter((element) => element.domain === domain.id).length;
    const own = model.relationships.filter(
      (relationship) =>
        domainOf.get(relationship.source) === domain.id && domainOf.get(relationship.target) === domain.id,
    ).length;
    const crossDomainCount = model.relationships.filter((relationship) => {
      const source = domainOf.get(relationship.source);
      const target = domainOf.get(relationship.target);
      return (source === domain.id && target !== domain.id) || (target === domain.id && source !== domain.id);
    }).length;
    return { domain, elementCount, relationshipCount: own, crossDomainCount };
  });
}

export function elementsWithoutDomain(model: Model): Model['elements'] {
  return model.elements.filter((element) => !element.domain);
}

export function environmentValues(model: Model): string[] {
  const values = new Set<string>();
  for (const element of model.elements) if (element.environment) values.add(element.environment);
  return [...values].sort();
}

export type TimeClassification = 'tolerate' | 'invest' | 'migrate' | 'eliminate';

export function timeClassification(model: Model, elementId: string): TimeClassification {
  const element = model.elements.find((candidate) => candidate.id === elementId);
  if (!element) return 'tolerate';
  const properties = new Map(element.properties.map((property) => [property.key.toLowerCase(), property.value.toLowerCase()]));
  const lifecycle = properties.get('lifecycle') ?? properties.get('status') ?? '';
  const criticality = properties.get('criticality') ?? '';
  if (lifecycle.includes('retire') || lifecycle.includes('end') || lifecycle.includes('sunset')) return 'eliminate';
  if (lifecycle.includes('deprecat') || lifecycle.includes('legacy')) return 'migrate';
  if (criticality.includes('high') || lifecycle.includes('strategic') || lifecycle.includes('invest')) return 'invest';
  return 'tolerate';
}

export interface PortfolioStats {
  workspaces: number;
  byStatus: Record<WorkspaceStatus, number>;
  byPurpose: Record<string, number>;
  elements: number;
  relationships: number;
  domains: number;
  artefacts: number;
  time: Record<TimeClassification, number>;
}

export function portfolioStats(models: Model[]): PortfolioStats {
  const byStatus: Record<WorkspaceStatus, number> = { draft: 0, active: 0, approved: 0, archived: 0 };
  const byPurpose: Record<string, number> = {};
  const time: Record<TimeClassification, number> = { tolerate: 0, invest: 0, migrate: 0, eliminate: 0 };
  let elements = 0;
  let relationships = 0;
  let domains = 0;
  let artefacts = 0;

  for (const model of models) {
    byStatus[model.status ?? 'draft'] += 1;
    byPurpose[model.purpose ?? 'as-is'] = (byPurpose[model.purpose ?? 'as-is'] ?? 0) + 1;
    elements += model.elements.length;
    relationships += model.relationships.length;
    domains += model.domains?.length ?? 0;
    artefacts += model.artefacts?.length ?? 0;
    for (const element of model.elements) {
      if (getElementType(element.type)?.layer === 'application') {
        time[timeClassification(model, element.id)] += 1;
      }
    }
  }

  return {
    workspaces: models.length,
    byStatus,
    byPurpose,
    elements,
    relationships,
    domains,
    artefacts,
    time,
  };
}

/** Workspace-level governance checks, on top of the structural model validation. */
export function validateWorkspace(model: Model): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!model.owner?.trim()) {
    issues.push({
      severity: 'warning',
      rule: 'workspace.owner',
      message: 'Workspace has no owner',
      suggestion: 'Set an accountable owner in workspace settings.',
    });
  }
  if (!model.domains?.length) {
    issues.push({
      severity: 'info',
      rule: 'workspace.domains',
      message: 'No domains defined',
      suggestion: 'Add domains so large models can be filtered by area.',
    });
  }
  const unassigned = elementsWithoutDomain(model);
  if (unassigned.length) {
    issues.push({
      severity: 'info',
      rule: 'workspace.unassigned-elements',
      entityId: unassigned[0].id,
      message: `${unassigned.length} element(s) are not assigned to a domain`,
      suggestion: 'Assign domains in the inspector or bulk-assign from workspace settings.',
    });
  }
  const missingEnvironment = model.elements.filter(
    (element) => ['ApplicationComponent', 'Node', 'Device', 'SystemSoftware'].includes(element.type) && !element.environment,
  );
  if (missingEnvironment.length) {
    issues.push({
      severity: 'info',
      rule: 'workspace.environment',
      message: `${missingEnvironment.length} deployment element(s) have no environment`,
      suggestion: 'Tag deployment elements with dev, staging, or prod.',
    });
  }
  return issues;
}

export function artefactMarkdown(artefact: Artefact): string {
  const lines = [
    `# ${artefact.title}`,
    '',
    `- Kind: ${artefact.kind}`,
    `- Status: ${artefact.status}`,
    artefact.author ? `- Author: ${artefact.author}` : '',
    `- Updated: ${artefact.updatedAt}`,
    artefact.elementIds.length ? `- Elements: ${artefact.elementIds.join(', ')}` : '',
    '',
    artefact.body,
    '',
  ];
  return lines.filter((line) => line !== '').join('\n');
}

export function workspaceSummary(model: Model): ModelSummary {
  return {
    id: model.id,
    name: primaryText(model.name) || 'Untitled workspace',
    description: primaryText(model.documentation),
    purpose: model.purpose ?? 'as-is',
    status: model.status ?? 'draft',
    owner: model.owner ?? '',
    tags: model.tags ?? [],
    elementCount: model.elements.length,
    relationshipCount: model.relationships.length,
    viewCount: model.views.length,
    domainCount: model.domains?.length ?? 0,
    artefactCount: model.artefacts?.length ?? 0,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
  };
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'domain';
}
