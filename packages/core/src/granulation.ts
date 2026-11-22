import { getElementType } from './metamodel';
import type {
  ArchiElement,
  GranulationLevel,
  Model,
  Relationship,
  View,
  ViewConfig,
  ViewEdge,
  ViewNode,
} from './types';
import { primaryText } from './types';

/**
 * Viewpoint-driven view generation with configurable granulation.
 *
 * A viewpoint answers *who is looking and why*; a granulation level answers
 * *how much detail*. The generated view keeps its recipe (`ViewConfig`) so it
 * can be regenerated when the model changes.
 */

export interface GranulationDefinition {
  id: GranulationLevel;
  label: string;
  description: string;
  elementTypes: string[];
  relationshipTypes: string[];
  attributes: string[];
}

export const GRANULATION_LEVELS: GranulationDefinition[] = [
  {
    id: 'L1',
    label: 'L1 — Landscape',
    description: 'Capabilities, value streams, services, and the application landscape.',
    elementTypes: [
      'Capability',
      'ValueStream',
      'BusinessService',
      'BusinessActor',
      'ApplicationComponent',
      'Node',
    ],
    relationshipTypes: ['Serving', 'Realization', 'Composition', 'Aggregation'],
    attributes: ['type', 'domain', 'owner', 'criticality'],
  },
  {
    id: 'L2',
    label: 'L2 — Application & process',
    description: 'Business processes, applications, services, and the data they use.',
    elementTypes: [
      'BusinessActor',
      'BusinessRole',
      'BusinessProcess',
      'BusinessService',
      'ApplicationComponent',
      'ApplicationService',
      'DataObject',
      'TechnologyService',
    ],
    relationshipTypes: ['Serving', 'Realization', 'Access', 'Flow', 'Assignment', 'Triggering'],
    attributes: ['type', 'domain', 'environment', 'version', 'owner'],
  },
  {
    id: 'L3',
    label: 'L3 — Component & deployment',
    description: 'Applications with the servers, system software, and artifacts behind them.',
    elementTypes: [
      'ApplicationComponent',
      'ApplicationService',
      'DataObject',
      'Node',
      'SystemSoftware',
      'Artifact',
      'TechnologyService',
      'TechnologyInterface',
    ],
    relationshipTypes: ['Serving', 'Realization', 'Assignment', 'Access', 'Composition'],
    attributes: ['type', 'environment', 'version', 'ip', 'owner'],
  },
  {
    id: 'L4',
    label: 'L4 — Infrastructure',
    description: 'Servers, devices, networks, system software, and deployed artifacts.',
    elementTypes: [
      'Node',
      'Device',
      'SystemSoftware',
      'Artifact',
      'CommunicationNetwork',
      'TechnologyInterface',
      'TechnologyService',
    ],
    relationshipTypes: ['Serving', 'Realization', 'Composition', 'Access'],
    attributes: ['type', 'environment', 'ip', 'version', 'owner'],
  },
];

export interface StakeholderProfile {
  id: string;
  name: string;
  role: string;
  concerns: string[];
  viewpointIds: string[];
}

export const STAKEHOLDERS: StakeholderProfile[] = [
  {
    id: 'cio',
    name: 'CIO / executive',
    role: 'Accountable for cost, risk, and capability coverage',
    concerns: ['Cost', 'Risk', 'Capability coverage', 'Roadmap'],
    viewpointIds: ['capability-landscape', 'value-stream'],
  },
  {
    id: 'enterprise-architect',
    name: 'Enterprise architect',
    role: 'Owns the landscape, standards, and target state',
    concerns: ['Landscape', 'Standards', 'Duplication', 'Target state'],
    viewpointIds: ['enterprise-landscape', 'dependency-impact'],
  },
  {
    id: 'solution-architect',
    name: 'Solution architect',
    role: 'Designs a solution and its integrations',
    concerns: ['Application structure', 'Integrations', 'Data', 'NFRs'],
    viewpointIds: ['solution-architecture', 'integration', 'data-architecture'],
  },
  {
    id: 'platform-engineer',
    name: 'Platform engineer',
    role: 'Runs and deploys the system',
    concerns: ['Deployment', 'Environments', 'Runtime', 'Operations'],
    viewpointIds: ['deployment', 'technology-lifecycle'],
  },
  {
    id: 'infrastructure-architect',
    name: 'Infrastructure architect',
    role: 'Owns servers, networks, and datacenters',
    concerns: ['Servers', 'Network', 'Datacenter', 'Capacity'],
    viewpointIds: ['infrastructure', 'deployment'],
  },
  {
    id: 'security-architect',
    name: 'Security architect',
    role: 'Owns access, data protection, and compliance',
    concerns: ['Access', 'Data classification', 'Compliance', 'Threats'],
    viewpointIds: ['security'],
  },
  {
    id: 'business-analyst',
    name: 'Business analyst',
    role: 'Maps processes and services to the business',
    concerns: ['Processes', 'Services', 'Roles', 'Objects'],
    viewpointIds: ['business-process', 'value-stream'],
  },
  {
    id: 'portfolio-manager',
    name: 'Portfolio manager',
    role: 'Manages lifecycle, cost, and rationalisation',
    concerns: ['Lifecycle', 'Cost', 'Obsolescence', 'TIME'],
    viewpointIds: ['technology-lifecycle', 'enterprise-landscape'],
  },
  {
    id: 'change-manager',
    name: 'Change / impact manager',
    role: 'Assesses the impact of change',
    concerns: ['Dependencies', 'Impact', 'Risk'],
    viewpointIds: ['dependency-impact'],
  },
  {
    id: 'product-owner',
    name: 'Product owner',
    role: 'Owns value delivery',
    concerns: ['Value stream', 'Outcomes', 'Services'],
    viewpointIds: ['value-stream', 'capability-landscape'],
  },
];

export interface ViewpointProfile {
  id: string;
  name: string;
  stakeholderId: string;
  description: string;
  concerns: string[];
  granulation: GranulationLevel;
  elementTypes: string[];
  relationshipTypes: string[];
  attributes: string[];
  groupBy: 'none' | 'domain' | 'layer';
  depth: number;
}

export const VIEWPOINT_CATALOG: ViewpointProfile[] = [
  {
    id: 'capability-landscape',
    name: 'Capability landscape',
    stakeholderId: 'cio',
    description: 'Capabilities and value streams, with the services that realise them.',
    concerns: ['Capability coverage', 'Investment', 'Value delivery'],
    granulation: 'L1',
    elementTypes: ['Capability', 'ValueStream', 'BusinessService', 'ApplicationComponent'],
    relationshipTypes: ['Serving', 'Realization', 'Composition'],
    attributes: ['type', 'domain', 'owner', 'criticality'],
    groupBy: 'domain',
    depth: 1,
  },
  {
    id: 'enterprise-landscape',
    name: 'Enterprise application landscape',
    stakeholderId: 'enterprise-architect',
    description: 'Applications, capabilities, and the nodes they run on.',
    concerns: ['Landscape', 'Duplication', 'Target state'],
    granulation: 'L1',
    elementTypes: ['Capability', 'BusinessService', 'ApplicationComponent', 'Node'],
    relationshipTypes: ['Serving', 'Realization', 'Composition'],
    attributes: ['type', 'domain', 'owner', 'criticality'],
    groupBy: 'domain',
    depth: 1,
  },
  {
    id: 'solution-architecture',
    name: 'Solution architecture',
    stakeholderId: 'solution-architect',
    description: 'Processes, applications, services, and data for one solution.',
    concerns: ['Application structure', 'Integrations', 'Data'],
    granulation: 'L2',
    elementTypes: [
      'BusinessActor',
      'BusinessProcess',
      'BusinessService',
      'ApplicationComponent',
      'ApplicationService',
      'DataObject',
    ],
    relationshipTypes: ['Serving', 'Realization', 'Access', 'Flow', 'Assignment'],
    attributes: ['type', 'domain', 'environment', 'version', 'owner'],
    groupBy: 'domain',
    depth: 1,
  },
  {
    id: 'integration',
    name: 'Integration map',
    stakeholderId: 'solution-architect',
    description: 'Applications and the services and data that connect them.',
    concerns: ['Integrations', 'Interfaces', 'Data flow'],
    granulation: 'L2',
    elementTypes: ['ApplicationComponent', 'ApplicationService', 'ApplicationInterface', 'DataObject'],
    relationshipTypes: ['Serving', 'Flow', 'Access', 'Realization'],
    attributes: ['type', 'environment', 'version', 'owner'],
    groupBy: 'none',
    depth: 1,
  },
  {
    id: 'deployment',
    name: 'Deployment topology',
    stakeholderId: 'platform-engineer',
    description: 'Applications with the servers, system software, and artifacts behind them.',
    concerns: ['Deployment', 'Environments', 'Runtime'],
    granulation: 'L3',
    elementTypes: [
      'ApplicationComponent',
      'ApplicationService',
      'Node',
      'SystemSoftware',
      'Artifact',
      'TechnologyService',
    ],
    relationshipTypes: ['Serving', 'Realization', 'Assignment', 'Composition'],
    attributes: ['type', 'environment', 'version', 'ip', 'owner'],
    groupBy: 'layer',
    depth: 1,
  },
  {
    id: 'infrastructure',
    name: 'Infrastructure',
    stakeholderId: 'infrastructure-architect',
    description: 'Servers, devices, networks, and deployed artifacts.',
    concerns: ['Servers', 'Network', 'Datacenter'],
    granulation: 'L4',
    elementTypes: [
      'Node',
      'Device',
      'SystemSoftware',
      'Artifact',
      'CommunicationNetwork',
      'TechnologyInterface',
    ],
    relationshipTypes: ['Serving', 'Realization', 'Composition', 'Access'],
    attributes: ['type', 'environment', 'ip', 'version', 'owner'],
    groupBy: 'domain',
    depth: 1,
  },
  {
    id: 'security',
    name: 'Security & access',
    stakeholderId: 'security-architect',
    description: 'Applications, data, nodes, and the requirements that constrain them.',
    concerns: ['Access', 'Data classification', 'Compliance'],
    granulation: 'L2',
    elementTypes: ['ApplicationComponent', 'DataObject', 'Node', 'Requirement', 'Constraint'],
    relationshipTypes: ['Access', 'Serving', 'Realization', 'Influence'],
    attributes: ['type', 'domain', 'criticality', 'owner'],
    groupBy: 'none',
    depth: 1,
  },
  {
    id: 'business-process',
    name: 'Business process',
    stakeholderId: 'business-analyst',
    description: 'Actors, roles, processes, services, and business objects.',
    concerns: ['Processes', 'Services', 'Roles'],
    granulation: 'L2',
    elementTypes: [
      'BusinessActor',
      'BusinessRole',
      'BusinessProcess',
      'BusinessService',
      'BusinessObject',
    ],
    relationshipTypes: ['Serving', 'Realization', 'Access', 'Triggering'],
    attributes: ['type', 'domain', 'owner'],
    groupBy: 'domain',
    depth: 1,
  },
  {
    id: 'value-stream',
    name: 'Value stream',
    stakeholderId: 'product-owner',
    description: 'Value streams, the capabilities that support them, and the services delivered.',
    concerns: ['Value delivery', 'Outcomes', 'Services'],
    granulation: 'L1',
    elementTypes: ['ValueStream', 'Capability', 'BusinessService', 'BusinessActor'],
    relationshipTypes: ['Serving', 'Realization'],
    attributes: ['type', 'domain', 'owner'],
    groupBy: 'none',
    depth: 1,
  },
  {
    id: 'technology-lifecycle',
    name: 'Technology lifecycle',
    stakeholderId: 'portfolio-manager',
    description: 'Applications and technology with version, environment, and owner.',
    concerns: ['Lifecycle', 'Cost', 'Obsolescence'],
    granulation: 'L3',
    elementTypes: ['ApplicationComponent', 'Node', 'SystemSoftware', 'Artifact'],
    relationshipTypes: ['Realization', 'Serving', 'Composition'],
    attributes: ['type', 'environment', 'version', 'owner', 'criticality'],
    groupBy: 'layer',
    depth: 1,
  },
  {
    id: 'data-architecture',
    name: 'Data architecture',
    stakeholderId: 'solution-architect',
    description: 'Data objects, the applications that access them, and the business objects they realise.',
    concerns: ['Data', 'Ownership', 'Flow'],
    granulation: 'L2',
    elementTypes: ['DataObject', 'BusinessObject', 'ApplicationComponent', 'ApplicationService'],
    relationshipTypes: ['Access', 'Realization', 'Flow'],
    attributes: ['type', 'domain', 'owner'],
    groupBy: 'domain',
    depth: 1,
  },
  {
    id: 'dependency-impact',
    name: 'Dependency & impact',
    stakeholderId: 'change-manager',
    description: 'The neighbourhood around selected elements, two hops deep.',
    concerns: ['Dependencies', 'Impact', 'Risk'],
    granulation: 'L2',
    elementTypes: [
      'ApplicationComponent',
      'ApplicationService',
      'DataObject',
      'Node',
      'TechnologyService',
    ],
    relationshipTypes: ['Serving', 'Realization', 'Access', 'Flow'],
    attributes: ['type', 'environment', 'version', 'owner'],
    groupBy: 'none',
    depth: 2,
  },
];

const viewpointIndex = new Map(VIEWPOINT_CATALOG.map((viewpoint) => [viewpoint.id, viewpoint]));
const granulationIndex = new Map(GRANULATION_LEVELS.map((level) => [level.id, level]));

export function getViewpointProfile(id: string): ViewpointProfile | undefined {
  return viewpointIndex.get(id);
}

export function getGranulation(id: GranulationLevel): GranulationDefinition {
  return granulationIndex.get(id) ?? GRANULATION_LEVELS[0];
}

export function defaultConfigFor(viewpointId: string): ViewConfig {
  const viewpoint = getViewpointProfile(viewpointId) ?? VIEWPOINT_CATALOG[0];
  const granulation = getGranulation(viewpoint.granulation);
  return {
    viewpointId: viewpoint.id,
    granulation: viewpoint.granulation,
    elementTypes: [...viewpoint.elementTypes],
    relationshipTypes: [...viewpoint.relationshipTypes],
    attributes: [...viewpoint.attributes],
    groupBy: viewpoint.groupBy,
    depth: viewpoint.depth,
  };
}

/** Types added when an element is expanded to the next level of detail. */
const EXPANSION: Record<GranulationLevel, string[]> = {
  L1: ['ApplicationComponent', 'ApplicationService', 'DataObject', 'Node'],
  L2: ['Node', 'SystemSoftware', 'Artifact', 'TechnologyService', 'TechnologyInterface'],
  L3: ['Node', 'Device', 'SystemSoftware', 'Artifact', 'CommunicationNetwork'],
  L4: [],
};

export interface BuildViewStats {
  elements: number;
  relationships: number;
  hiddenElements: number;
  groups: number;
  expanded: number;
}

export interface BuildViewResult {
  view: View;
  stats: BuildViewStats;
}

const NODE_W = 190;
const NODE_H = 88;
const H_GAP = 46;
const V_GAP = 54;
const COLUMNS = 4;
const GROUP_HEADER = 30;

function attributeValue(
  element: ArchiElement,
  key: string,
  domains: Model['domains'],
): string | undefined {
  const lower = key.toLowerCase();
  if (lower === 'type') return getElementType(element.type)?.label ?? element.type;
  if (lower === 'domain') {
    return domains?.find((domain) => domain.id === element.domain)?.name;
  }
  if (lower === 'environment') return element.environment;
  const property = element.properties.find((item) => item.key.toLowerCase() === lower);
  return property?.value;
}

export function elementAttributes(
  domains: Model['domains'],
  element: ArchiElement,
  keys: string[],
): Array<{ key: string; value: string }> {
  return keys
    .map((key) => ({ key, value: attributeValue(element, key, domains) ?? '' }))
    .filter((item) => item.value)
    .slice(0, 4);
}

/**
 * Build a view from a viewpoint, granulation level, filters, dependency depth,
 * and optional expanded elements.
 */
export function buildConfiguredView(
  model: Model,
  config: ViewConfig,
  options: { id?: string; name?: string } = {},
): BuildViewResult {
  const granulation = getGranulation(config.granulation);
  const visibleTypes = new Set(
    config.elementTypes.length ? config.elementTypes : granulation.elementTypes,
  );
  const allowedRelationships = new Set(
    config.relationshipTypes.length ? config.relationshipTypes : granulation.relationshipTypes,
  );

  const passesFilters = (element: ArchiElement): boolean => {
    if (config.domainFilter && config.domainFilter !== 'all' && element.domain !== config.domainFilter) {
      return false;
    }
    if (
      config.environmentFilter &&
      config.environmentFilter !== 'all' &&
      element.environment &&
      element.environment !== config.environmentFilter
    ) {
      return false;
    }
    return true;
  };

  const base = model.elements.filter(
    (element) => visibleTypes.has(element.type) && passesFilters(element),
  );
  const visible = new Map(base.map((element) => [element.id, element]));

  // Dependency neighbourhood from explicit roots.
  if (config.rootElementIds?.length) {
    const roots = new Set(config.rootElementIds);
    let frontier = [...roots];
    const visited = new Set<string>(roots);
    for (let depth = 0; depth < Math.max(1, config.depth); depth += 1) {
      const next: string[] = [];
      const frontierSet = new Set(frontier);
      for (const relationship of model.relationships) {
        if (!allowedRelationships.has(relationship.type)) continue;
        for (const [from, to] of [
          [relationship.source, relationship.target],
          [relationship.target, relationship.source],
        ] as const) {
          if (!frontierSet.has(from) || visited.has(to)) continue;
          visited.add(to);
          next.push(to);
        }
      }
      frontier = next;
    }
    for (const id of visited) {
      const element = model.elements.find((candidate) => candidate.id === id);
      if (element && passesFilters(element)) visible.set(element.id, element);
    }
  }

  // Expand lower-level detail behind selected elements (e.g. servers behind an app).
  let expanded = 0;
  const expansionTypes = new Set(EXPANSION[config.granulation]);
  if (config.expandElementIds?.length && expansionTypes.size) {
    const expand = new Set(config.expandElementIds);
    for (const relationship of model.relationships) {
      if (!allowedRelationships.has(relationship.type)) continue;
      const pairs: Array<[string, string]> = [
        [relationship.source, relationship.target],
        [relationship.target, relationship.source],
      ];
      for (const [from, to] of pairs) {
        if (!expand.has(from) || visible.has(to)) continue;
        const element = model.elements.find((candidate) => candidate.id === to);
        if (!element || !expansionTypes.has(element.type) || !passesFilters(element)) continue;
        visible.set(element.id, element);
        expanded += 1;
      }
    }
  }

  const elements = [...visible.values()];
  /**
   * Node/edge/group ids must be unique across the whole document (AOEF ids
   * are xs:ID and document-global), so generated ids are namespaced with the
   * view id — two generated views sharing elements must never collide.
   */
  const viewKey = slug(options.id ?? `view-${config.viewpointId}`);
  const relationships = model.relationships.filter(
    (relationship) =>
      allowedRelationships.has(relationship.type) &&
      visible.has(relationship.source) &&
      visible.has(relationship.target),
  );

  // Group and lay out.
  const groupKey = (element: ArchiElement): string => {
    if (config.groupBy === 'domain') {
      return model.domains?.find((domain) => domain.id === element.domain)?.name ?? 'Unassigned';
    }
    if (config.groupBy === 'layer') {
      return getElementType(element.type)?.layer ?? 'other';
    }
    return 'All elements';
  };

  const grouped = new Map<string, ArchiElement[]>();
  for (const element of elements) {
    const key = groupKey(element);
    grouped.set(key, [...(grouped.get(key) ?? []), element]);
  }
  const groupNames = [...grouped.keys()].sort((a, b) => a.localeCompare(b));

  const nodes: ViewNode[] = [];
  const nodeOf = new Map<string, string>();
  let y = 40;

  for (const groupName of groupNames) {
    const members = (grouped.get(groupName) ?? []).sort((a, b) =>
      primaryText(a.name).localeCompare(primaryText(b.name)),
    );
    if (config.groupBy !== 'none') {
      nodes.push({
        id: `group-${viewKey}-${slug(groupName)}`,
        type: 'Label',
        label: [{ lang: 'en', value: groupName }],
        bounds: { x: 30, y, w: 240, h: 24 },
      });
      y += GROUP_HEADER;
    }
    const rows = Math.ceil(members.length / COLUMNS);
    members.forEach((element, index) => {
      const nodeId = `gen-${viewKey}-${element.id}`;
      nodeOf.set(element.id, nodeId);
      nodes.push({
        id: nodeId,
        type: 'Element',
        elementRef: element.id,
        label: [],
        bounds: {
          x: 40 + (index % COLUMNS) * (NODE_W + H_GAP),
          y: y + Math.floor(index / COLUMNS) * (NODE_H + V_GAP),
          w: NODE_W,
          h: NODE_H,
        },
      });
    });
    y += rows * (NODE_H + V_GAP) + 26;
  }

  const edges: ViewEdge[] = relationships
    .filter((relationship) => nodeOf.has(relationship.source) && nodeOf.has(relationship.target))
    .map((relationship: Relationship) => ({
      id: `gen-edge-${viewKey}-${relationship.id}`,
      type: 'Relationship',
      relationshipRef: relationship.id,
      source: nodeOf.get(relationship.source)!,
      target: nodeOf.get(relationship.target)!,
      bendpoints: [],
    }));

  const viewpoint = getViewpointProfile(config.viewpointId);
  const view: View = {
    id: options.id ?? `view-${config.viewpointId}-${Date.now()}`,
    type: 'Diagram',
    name: [
      {
        lang: 'en',
        value:
          options.name ??
          `${viewpoint?.name ?? 'View'} · ${config.granulation}`,
      },
    ],
    nodes,
    edges,
    config,
  };

  return {
    view,
    stats: {
      elements: elements.length,
      relationships: edges.length,
      hiddenElements: model.elements.length - elements.length,
      groups: config.groupBy === 'none' ? 1 : groupNames.length,
      expanded,
    },
  };
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'group';
}
