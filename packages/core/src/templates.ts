import type {
  ArchiElement,
  Artefact,
  Domain,
  Model,
  ModelPurpose,
  Relationship,
  View,
} from './types';
import { createArtefact, createDomain } from './workspace';

export interface WorkspaceTemplate {
  id: string;
  name: string;
  description: string;
  purpose: ModelPurpose;
  tags: string[];
  create(): Model;
}

interface ElementSpec {
  id: string;
  type: string;
  name: string;
  domain?: string;
  environment?: string;
  documentation?: string;
}

interface RelationshipSpec {
  id: string;
  type: string;
  source: string;
  target: string;
  name?: string;
}

interface BuildConfig {
  id: string;
  name: string;
  description: string;
  purpose: ModelPurpose;
  owner: string;
  tags: string[];
  domains: Domain[];
  elements: ElementSpec[];
  relationships: RelationshipSpec[];
  artefacts?: Artefact[];
}

const COLUMNS = 4;
const NODE_WIDTH = 180;
const NODE_HEIGHT = 68;
const H_GAP = 60;
const V_GAP = 80;

function buildModel(config: BuildConfig): Model {
  const nodes = config.elements.map((element, index) => ({
    id: `node-${element.id}`,
    type: 'Element',
    elementRef: element.id,
    label: [],
    bounds: {
      x: 60 + (index % COLUMNS) * (NODE_WIDTH + H_GAP),
      y: 60 + Math.floor(index / COLUMNS) * (NODE_HEIGHT + V_GAP),
      w: NODE_WIDTH,
      h: NODE_HEIGHT,
    },
  }));
  const nodeOf = new Map(config.elements.map((element) => [element.id, `node-${element.id}`]));

  const elements: ArchiElement[] = config.elements.map((element) => ({
    id: element.id,
    type: element.type,
    name: [{ lang: 'en', value: element.name }],
    documentation: element.documentation ? [{ lang: 'en', value: element.documentation }] : [],
    properties: [],
    domain: element.domain,
    environment: element.environment,
  }));

  const relationships: Relationship[] = config.relationships.map((relationship) => ({
    id: relationship.id,
    type: relationship.type,
    source: relationship.source,
    target: relationship.target,
    name: relationship.name ? [{ lang: 'en', value: relationship.name }] : [],
    documentation: [],
    properties: [],
  }));

  const view: View = {
    id: `view-${config.id}`,
    type: 'Diagram',
    name: [{ lang: 'en', value: 'Overview' }],
    nodes,
    edges: config.relationships
      .filter((relationship) => nodeOf.has(relationship.source) && nodeOf.has(relationship.target))
      .map((relationship) => ({
        id: `edge-${relationship.id}`,
        type: 'Relationship',
        relationshipRef: relationship.id,
        source: nodeOf.get(relationship.source)!,
        target: nodeOf.get(relationship.target)!,
        bendpoints: [],
      })),
  };

  return {
    id: `template-${config.id}-${Math.random().toString(36).slice(2, 8)}`,
    name: [{ lang: 'en', value: config.name }],
    documentation: [{ lang: 'en', value: config.description }],
    properties: [],
    propertyDefinitions: [],
    elements,
    relationships,
    views: [view],
    purpose: config.purpose,
    status: 'draft',
    owner: config.owner,
    tags: config.tags,
    domains: config.domains,
    artefacts: config.artefacts ?? [],
    approvals: [],
    createdAt: new Date().toISOString(),
  };
}

function domains(names: string[]): Domain[] {
  return names.map((name, index) => createDomain(name, { id: `domain-${index + 1}` }));
}

export const WORKSPACE_TEMPLATES: WorkspaceTemplate[] = [
  {
    id: 'blank',
    name: 'Blank workspace',
    description: 'An empty ArchiMate model with one view.',
    purpose: 'as-is',
    tags: [],
    create: () =>
      buildModel({
        id: 'blank',
        name: 'Untitled workspace',
        description: '',
        purpose: 'as-is',
        owner: '',
        tags: [],
        domains: [],
        elements: [],
        relationships: [],
      }),
  },
  {
    id: 'archimate-starter',
    name: 'ArchiMate starter',
    description: 'Business, application, and technology layers with a sample service chain.',
    purpose: 'as-is',
    tags: ['archimate', 'starter'],
    create: () =>
      buildModel({
        id: 'archimate-starter',
        name: 'ArchiMate starter',
        description: 'A small cross-layer model to start from.',
        purpose: 'as-is',
        owner: '',
        tags: ['archimate'],
        domains: domains(['Business', 'Application', 'Technology']),
        elements: [
          { id: 'customer', type: 'BusinessActor', name: 'Customer', domain: 'domain-1' },
          { id: 'claim-process', type: 'BusinessProcess', name: 'Handle claim', domain: 'domain-1' },
          { id: 'claims-service', type: 'BusinessService', name: 'Claims service', domain: 'domain-1' },
          { id: 'portal', type: 'ApplicationComponent', name: 'Claims portal', domain: 'domain-2' },
          { id: 'portal-api', type: 'ApplicationService', name: 'Claims API', domain: 'domain-2' },
          { id: 'claim-record', type: 'DataObject', name: 'Claim record', domain: 'domain-2' },
          { id: 'app-server', type: 'Node', name: 'Application server', domain: 'domain-3' },
          { id: 'claims-db', type: 'Artifact', name: 'claims.db', domain: 'domain-3' },
        ],
        relationships: [
          { id: 'r1', type: 'Assignment', source: 'customer', target: 'claim-process' },
          { id: 'r2', type: 'Realization', source: 'claim-process', target: 'claims-service' },
          { id: 'r3', type: 'Realization', source: 'portal', target: 'claims-service' },
          { id: 'r4', type: 'Realization', source: 'portal', target: 'portal-api' },
          { id: 'r5', type: 'Access', source: 'portal', target: 'claim-record' },
          { id: 'r6', type: 'Serving', source: 'app-server', target: 'portal' },
          { id: 'r7', type: 'Realization', source: 'portal', target: 'app-server' },
        ],
      }),
  },
  {
    id: 'cloud-landing-zone',
    name: 'Cloud landing zone',
    description: 'Network, compute, data, and environments for a typical cloud workload.',
    purpose: 'to-be',
    tags: ['cloud', 'infrastructure'],
    create: () =>
      buildModel({
        id: 'cloud-landing-zone',
        name: 'Cloud landing zone',
        description: 'A three-tier workload on a cloud landing zone.',
        purpose: 'to-be',
        owner: '',
        tags: ['cloud', 'infrastructure'],
        domains: domains(['Network', 'Compute', 'Data']),
        elements: [
          { id: 'users', type: 'BusinessActor', name: 'Users', domain: 'domain-1' },
          { id: 'edge', type: 'TechnologyService', name: 'HTTPS endpoint', domain: 'domain-1', environment: 'prod' },
          { id: 'vpc', type: 'CommunicationNetwork', name: 'VPC', domain: 'domain-1', environment: 'prod' },
          { id: 'app-tier', type: 'Node', name: 'Application tier', domain: 'domain-2', environment: 'prod' },
          { id: 'container', type: 'Artifact', name: 'app image', domain: 'domain-2', environment: 'prod' },
          { id: 'api', type: 'ApplicationComponent', name: 'Claims API', domain: 'domain-2', environment: 'prod' },
          { id: 'db', type: 'Node', name: 'PostgreSQL', domain: 'domain-3', environment: 'prod' },
          { id: 'bucket', type: 'Artifact', name: 'Document bucket', domain: 'domain-3', environment: 'prod' },
        ],
        relationships: [
          { id: 'r1', type: 'Serving', source: 'users', target: 'edge' },
          { id: 'r2', type: 'Serving', source: 'edge', target: 'app-tier' },
          { id: 'r3', type: 'Serving', source: 'vpc', target: 'app-tier' },
          { id: 'r4', type: 'Serving', source: 'app-tier', target: 'api' },
          { id: 'r5', type: 'Realization', source: 'container', target: 'api' },
          { id: 'r6', type: 'Serving', source: 'app-tier', target: 'db' },
          { id: 'r7', type: 'Access', source: 'api', target: 'bucket' },
        ],
      }),
  },
  {
    id: 'togaf-architecture-vision',
    name: 'TOGAF Architecture Vision',
    description: 'Stakeholders, drivers, goals, principles, requirements, and a first ADR.',
    purpose: 'to-be',
    tags: ['togaf', 'adm', 'vision'],
    create: () =>
      buildModel({
        id: 'togaf-vision',
        name: 'Architecture Vision',
        description: 'Phase A artefact set for a transformation initiative.',
        purpose: 'to-be',
        owner: '',
        tags: ['togaf', 'adm'],
        domains: domains(['Motivation', 'Strategy', 'Implementation']),
        elements: [
          { id: 'stakeholder', type: 'Stakeholder', name: 'Chief Architect', domain: 'domain-1' },
          { id: 'driver', type: 'Driver', name: 'Digital transformation', domain: 'domain-1' },
          { id: 'goal', type: 'Goal', name: 'Reduce time to market', domain: 'domain-1' },
          { id: 'principle', type: 'Principle', name: 'API-first', domain: 'domain-1' },
          { id: 'requirement', type: 'Requirement', name: 'Cloud-first hosting', domain: 'domain-1' },
          { id: 'capability', type: 'Capability', name: 'Integration', domain: 'domain-2' },
          { id: 'baseline', type: 'Plateau', name: 'Baseline 2026', domain: 'domain-3' },
          { id: 'target', type: 'Plateau', name: 'Target 2027', domain: 'domain-3' },
          { id: 'workpackage', type: 'WorkPackage', name: 'Migration wave 1', domain: 'domain-3' },
          { id: 'deliverable', type: 'Deliverable', name: 'Landing zone', domain: 'domain-3' },
        ],
        relationships: [
          { id: 'r1', type: 'Association', source: 'stakeholder', target: 'driver' },
          { id: 'r2', type: 'Influence', source: 'driver', target: 'goal' },
          { id: 'r3', type: 'Influence', source: 'goal', target: 'requirement' },
          { id: 'r4', type: 'Influence', source: 'principle', target: 'requirement' },
          { id: 'r5', type: 'Influence', source: 'requirement', target: 'capability' },
          { id: 'r6', type: 'Association', source: 'baseline', target: 'target' },
          { id: 'r7', type: 'Realization', source: 'workpackage', target: 'deliverable' },
          { id: 'r8', type: 'Influence', source: 'target', target: 'capability' },
        ],
        artefacts: [
          createArtefact(
            'adr',
            'ADR-001 Use a cloud landing zone',
            '## Context\n\nWe need a repeatable environment for new workloads.\n\n## Decision\n\nAdopt a landing zone with network, identity, and logging.\n\n## Consequences\n\nFaster onboarding; shared guardrails.',
            { status: 'accepted', elementIds: ['workpackage', 'deliverable'] },
          ),
          createArtefact(
            'principle',
            'API-first',
            'All new capabilities expose a documented API before a user interface.',
            { status: 'accepted', elementIds: ['principle'] },
          ),
        ],
      }),
  },
  {
    id: 'integration-landscape',
    name: 'Integration landscape',
    description: 'Applications, interfaces, data objects, and flows across a domain.',
    purpose: 'as-is',
    tags: ['integration', 'application'],
    create: () =>
      buildModel({
        id: 'integration-landscape',
        name: 'Integration landscape',
        description: 'How core applications exchange data.',
        purpose: 'as-is',
        owner: '',
        tags: ['integration'],
        domains: domains(['Customer', 'Finance', 'Data']),
        elements: [
          { id: 'crm', type: 'ApplicationComponent', name: 'CRM', domain: 'domain-1' },
          { id: 'customer-api', type: 'ApplicationService', name: 'Customer API', domain: 'domain-1' },
          { id: 'customer', type: 'DataObject', name: 'Customer', domain: 'domain-1' },
          { id: 'billing', type: 'ApplicationComponent', name: 'Billing', domain: 'domain-2' },
          { id: 'invoice', type: 'DataObject', name: 'Invoice', domain: 'domain-2' },
          { id: 'warehouse', type: 'ApplicationComponent', name: 'Data warehouse', domain: 'domain-3' },
          { id: 'report', type: 'DataObject', name: 'Revenue report', domain: 'domain-3' },
        ],
        relationships: [
          { id: 'r1', type: 'Realization', source: 'crm', target: 'customer-api' },
          { id: 'r2', type: 'Access', source: 'crm', target: 'customer' },
          { id: 'r3', type: 'Serving', source: 'customer-api', target: 'billing' },
          { id: 'r4', type: 'Access', source: 'billing', target: 'invoice' },
          { id: 'r5', type: 'Association', source: 'billing', target: 'warehouse' },
          { id: 'r6', type: 'Access', source: 'warehouse', target: 'report' },
        ],
      }),
  },
];

export function getWorkspaceTemplate(id: string): WorkspaceTemplate | undefined {
  return WORKSPACE_TEMPLATES.find((template) => template.id === id);
}

export function createFromTemplate(id: string, overrides: { name?: string; owner?: string } = {}): Model {
  const template = getWorkspaceTemplate(id) ?? WORKSPACE_TEMPLATES[0];
  const model = template.create();
  if (overrides.name) model.name = [{ lang: 'en', value: overrides.name }];
  if (overrides.owner !== undefined) model.owner = overrides.owner;
  return model;
}
