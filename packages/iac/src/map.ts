import {
  getElementType,
  getRelationshipType,
  isAllowedRelationship,
  primaryText,
  type ArchiElement,
  type Property,
  type Relationship,
} from '@openarch/core';
import type { IacImport, IacOptions, IacResource } from './types';
import { humanizeName, slug } from './utils';

interface TypeMatch {
  type: string;
  known: boolean;
}

interface TypeRule {
  pattern: RegExp;
  type: string;
}

interface OrientedPair {
  source: ArchiElement;
  target: ArchiElement;
}

const KUBERNETES_TYPE_MAP: Record<string, string> = {
  namespace: 'Grouping',
  configmap: 'Artifact',
  secret: 'Artifact',
  persistentvolumeclaim: 'Artifact',
  service: 'TechnologyService',
  ingress: 'TechnologyInterface',
  deployment: 'Node',
  statefulset: 'Node',
  daemonset: 'Node',
  job: 'Node',
  cronjob: 'Node',
  pod: 'Node',
  replicaset: 'Node',
  replicationcontroller: 'Node',
};

const COMPOSE_TYPE_MAP: Record<string, string> = {
  service: 'SystemSoftware',
  volume: 'Artifact',
  network: 'CommunicationNetwork',
};

const TYPE_RULES: TypeRule[] = [
  { pattern: /^service$/, type: 'TechnologyService' },
  { pattern: /^(kube|k8s|kubernetes)_?service$/, type: 'TechnologyService' },
  { pattern: /(^|_)namespace($|_)/, type: 'Grouping' },
  { pattern: /(^|_)(config_?map|secret|persistent_?volume_?claim)($|_)/, type: 'Artifact' },
  { pattern: /(^|_)(virtual_network|virtualnetwork|vpc|network)($|_)/, type: 'CommunicationNetwork' },
  { pattern: /(^|_)(subnet|subnetwork)($|_)/, type: 'Grouping' },
  {
    pattern:
      /(^|_)(load_balancer|loadbalancer|lb|alb|elb|application_gateway|applicationgateway|api_gateway|apigateway)($|_)/,
    type: 'TechnologyService',
  },
  { pattern: /(^|_)(virtual_machine|virtualmachine)($|_)/, type: 'Node' },
  { pattern: /(^|_)(app_service|appservice|cloud_run|cloudrun)($|_)/, type: 'SystemSoftware' },
  { pattern: /(^|_)(lambda|function)($|_)/, type: 'SystemSoftware' },
  { pattern: /(^|_)container($|_)/, type: 'SystemSoftware' },
  { pattern: /(^|_)(instance|vm|compute)($|_)/, type: 'Node' },
  { pattern: /(^|_)(database|db|rds|postgres|postgresql|mysql|sql)($|_)/, type: 'Node' },
  {
    pattern: /(^|_)(bucket|storage|blob|volume|artifact|persistent_?volume)($|_)/,
    type: 'Artifact',
  },
  { pattern: /(^|_)(ingress|route|gateway)($|_)/, type: 'TechnologyInterface' },
  {
    pattern:
      /(^|_)(deployment|statefulset|daemonset|job|cronjob|pod|replicaset|replicationcontroller)($|_)/,
    type: 'Node',
  },
];

const WORKLOAD_TYPES = new Set([
  'Node',
  'Device',
  'SystemSoftware',
  'TechnologyCollaboration',
  'TechnologyInterface',
  'TechnologyService',
  'ApplicationComponent',
  'ApplicationInterface',
  'ApplicationService',
  'BusinessActor',
  'BusinessRole',
  'BusinessService',
]);

/**
 * Map parsed IaC resources onto ArchiMate elements and relationships.
 * The result is deterministic: ids derive from resource addresses and
 * relationships are deduplicated by source/target pair.
 */
export function mapResources(resources: IacResource[], options: IacOptions = {}): IacImport {
  const warnings: string[] = [];
  const unique = dedupeResources(resources, warnings);
  const elements: ArchiElement[] = [];
  const elementByAddress = new Map<string, ArchiElement>();

  for (const resource of unique) {
    const match = mapResourceType(resource);
    if (!match.known) {
      warnings.push(
        `Unknown IaC kind "${resource.kind}" for ${resource.address}; mapped to ${match.type}.`,
      );
    }

    const element = createElement(resource, match.type, options);
    elements.push(element);
    elementByAddress.set(resource.address, element);
  }

  const relationships = createRelationships(unique, elementByAddress, warnings);
  return { elements, relationships, warnings };
}

function dedupeResources(resources: IacResource[], warnings: string[]): IacResource[] {
  const seen = new Set<string>();
  const unique: IacResource[] = [];

  for (const resource of resources) {
    if (seen.has(resource.address)) {
      warnings.push(`Skipped duplicate IaC resource "${resource.address}".`);
      continue;
    }
    seen.add(resource.address);
    unique.push(resource);
  }

  return unique;
}

function createElement(resource: IacResource, type: string, options: IacOptions): ArchiElement {
  const idPrefix = slug(options.idPrefix ?? 'iac');
  const environment = options.environment ?? resource.environment;
  const properties: Property[] = [
    { key: 'source', value: 'iac' },
    { key: 'iacAddress', value: resource.address },
    { key: 'iacKind', value: resource.kind },
  ];
  if (environment) properties.push({ key: 'environment', value: environment });
  // Stable digest of the resource attributes so re-imports can detect drift.
  const attributeKeys = Object.keys(resource.attributes).sort();
  if (attributeKeys.length) {
    properties.push({
      key: 'iacAttributes',
      value: JSON.stringify(attributeKeys.map((key) => [key, resource.attributes[key]])),
    });
  }

  const provider = resource.provider ? ` (${resource.provider})` : '';
  const element: ArchiElement = {
    id: `${idPrefix}-${slug(resource.address)}`,
    type,
    name: [{ lang: 'en', value: humanizeName(resource.name) }],
    documentation: [
      {
        lang: 'en',
        value: `Imported from ${resource.kind}${provider} at ${resource.address}.`,
      },
    ],
    properties,
  };

  if (options.domain) element.domain = options.domain;
  if (environment) element.environment = environment;
  return element;
}

function createRelationships(
  resources: IacResource[],
  elementByAddress: Map<string, ArchiElement>,
  warnings: string[],
): Relationship[] {
  const relationships: Relationship[] = [];
  const seen = new Set<string>();

  for (const resource of resources) {
    const source = elementByAddress.get(resource.address);
    if (!source) continue;

    for (const dependency of resource.dependencies) {
      const target = elementByAddress.get(dependency);
      if (!target) {
        warnings.push(
          `Skipped dependency "${dependency}" from "${resource.address}": target was not imported.`,
        );
        continue;
      }

      if (target.id === source.id) {
        warnings.push(`Skipped self-dependency on "${resource.address}".`);
        continue;
      }

      const oriented = orientContainment(source, target);
      const type = chooseRelationshipType(oriented.source, oriented.target);
      if (!type) {
        warnings.push(
          `Skipped dependency "${resource.address}" -> "${dependency}": no allowed ArchiMate relationship.`,
        );
        continue;
      }

      const sourceAddress = oriented.source === source ? resource.address : dependency;
      const targetAddress = oriented.target === target ? dependency : resource.address;
      const id = `rel-iac-${slug(sourceAddress)}-${slug(targetAddress)}`;
      if (seen.has(id)) continue;
      seen.add(id);

      relationships.push(
        createRelationship(type, oriented.source, oriented.target, sourceAddress, targetAddress),
      );
    }
  }

  return relationships;
}

function createRelationship(
  type: string,
  source: ArchiElement,
  target: ArchiElement,
  sourceAddress: string,
  targetAddress: string,
): Relationship {
  return {
    id: `rel-iac-${slug(sourceAddress)}-${slug(targetAddress)}`,
    type,
    source: source.id,
    target: target.id,
    name: [],
    documentation: [
      {
        lang: 'en',
        value: `Derived from the IaC dependency between ${sourceAddress} and ${targetAddress} (${primaryText(source.name)} -> ${primaryText(target.name)}).`,
      },
    ],
    properties: [{ key: 'source', value: 'iac' }],
  };
}

/**
 * Containment relationships point from the container to its member, even when
 * the dependency was declared by the member (e.g. an instance depends_on a subnet).
 */
function orientContainment(source: ArchiElement, target: ArchiElement): OrientedPair {
  const sourceContainer = isContainerType(source.type);
  const targetContainer = isContainerType(target.type);

  if (!sourceContainer && targetContainer) return { source: target, target: source };
  if (source.type === 'Grouping' && target.type === 'CommunicationNetwork') {
    return { source: target, target: source };
  }
  return { source, target };
}

function chooseRelationshipType(
  source: ArchiElement,
  target: ArchiElement,
): string | undefined {
  if (isContainerType(source.type)) {
    return allowedType('Composition', source, target);
  }

  if (isWorkloadType(source.type) && isWorkloadType(target.type)) {
    return allowedType('Serving', source, target);
  }

  if (isWorkloadType(source.type) && target.type === 'Artifact') {
    return allowedType('Access', source, target);
  }

  for (const candidate of ['Composition', 'Serving', 'Access']) {
    const type = allowedType(candidate, source, target);
    if (type) return type;
  }

  return undefined;
}

function allowedType(
  type: string,
  source: ArchiElement,
  target: ArchiElement,
): string | undefined {
  return isRelationshipAllowed(type, source, target) ? type : undefined;
}

/**
 * The core metamodel denies same-type relationships via denySelf. For distinct
 * workload elements of the same type (e.g. two compose services) Serving is
 * still meaningful, so allow it while keeping every other rule intact.
 */
function isRelationshipAllowed(
  type: string,
  source: ArchiElement,
  target: ArchiElement,
): boolean {
  if (isAllowedRelationship(type, source.type, target.type)) return true;
  if (type !== 'Serving' || source.id === target.id) return false;
  if (!isWorkloadType(source.type) || !isWorkloadType(target.type)) return false;

  const relationship = getRelationshipType('Serving');
  const sourceDefinition = getElementType(source.type);
  const targetDefinition = getElementType(target.type);
  if (!relationship || !sourceDefinition || !targetDefinition) return false;

  return (
    relationship.sourceKinds.includes(sourceDefinition.kind) &&
    relationship.targetKinds.includes(targetDefinition.kind)
  );
}

function isContainerType(type: string): boolean {
  return type === 'CommunicationNetwork' || type === 'Grouping';
}

function isWorkloadType(type: string): boolean {
  return WORKLOAD_TYPES.has(type);
}

function mapResourceType(resource: IacResource): TypeMatch {
  const kind = resource.kind;
  const kubernetes = kubernetesKind(kind);
  if (kubernetes && KUBERNETES_TYPE_MAP[kubernetes]) {
    return { type: resolveType(KUBERNETES_TYPE_MAP[kubernetes]), known: true };
  }

  const compose = composeKind(kind);
  if (compose && COMPOSE_TYPE_MAP[compose]) {
    return { type: resolveType(COMPOSE_TYPE_MAP[compose]), known: true };
  }

  const normalized = kind.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  for (const rule of TYPE_RULES) {
    if (rule.pattern.test(normalized)) {
      return { type: resolveType(rule.type), known: true };
    }
  }

  return { type: 'Node', known: false };
}

function kubernetesKind(kind: string): string | undefined {
  const normalized = kind.toLowerCase();
  if (normalized.startsWith('kubernetes.')) {
    return normalized.slice('kubernetes.'.length).replace(/_/g, '');
  }
  if (normalized.startsWith('kubernetes_')) {
    return normalized.slice('kubernetes_'.length).replace(/_/g, '');
  }
  return undefined;
}

function composeKind(kind: string): string | undefined {
  const normalized = kind.toLowerCase();
  if (normalized.startsWith('compose.')) return normalized.slice('compose.'.length);
  if (normalized.startsWith('compose_')) return normalized.slice('compose_'.length);
  return undefined;
}

function resolveType(candidate: string): string {
  return getElementType(candidate) ? candidate : 'Node';
}
