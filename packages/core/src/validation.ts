import { getElementType, getRelationshipType, isAllowedRelationship, metamodelVersions } from './metamodel';
import type { Model } from './types';
import { primaryText } from './types';

export interface ValidationIssue {
  severity: 'error' | 'warning' | 'info';
  message: string;
  entityId?: string;
  rule: string;
  suggestion?: string;
}

export interface ValidationOptions {
  /** Elevate notation/style findings to errors. */
  strict?: boolean;
}

/** Structural checks that run identically in the browser, server, and CLI. */
export function validateModel(model: Model, options: ValidationOptions = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const elements = new Map<string, string>();

  if (!primaryText(model.name)) {
    issues.push({ severity: 'warning', rule: 'model.name', message: 'Model has no name' });
  }

  if (model.metamodelVersion && !metamodelVersions().includes(model.metamodelVersion)) {
    issues.push({
      severity: 'warning',
      rule: 'model.metamodel-version',
      message: `Model targets metamodel version "${model.metamodelVersion}", which is not registered (available: ${metamodelVersions().join(', ')})`,
      suggestion: 'Register the metamodel version or set the model back to 3.2.',
    });
  }

  for (const element of model.elements) {
    if (elements.has(element.id)) {
      issues.push({
        severity: 'error',
        rule: 'element.unique-id',
        entityId: element.id,
        message: `Duplicate element id: ${element.id}`,
      });
    }
    elements.set(element.id, element.type);
    if (!primaryText(element.name)) {
      issues.push({
        severity: 'warning',
        rule: 'element.name',
        entityId: element.id,
        message: `Element ${element.id} has no name`,
      });
    }
    if (!getElementType(element.type)) {
      issues.push({
        severity: 'warning',
        rule: 'element.unknown-type',
        entityId: element.id,
        message: `Element type "${element.type}" is not in the Phase 0 metamodel`,
      });
    }
  }

  const relationshipIds = new Set<string>();
  for (const relationship of model.relationships) {
    if (relationshipIds.has(relationship.id)) {
      issues.push({
        severity: 'error',
        rule: 'relationship.unique-id',
        entityId: relationship.id,
        message: `Duplicate relationship id: ${relationship.id}`,
      });
    }
    relationshipIds.add(relationship.id);
    if (relationship.source === relationship.target) {
      issues.push({
        severity: 'error',
        rule: 'relationship.self',
        entityId: relationship.id,
        message: `Relationship ${relationship.id} connects an element to itself`,
        suggestion: 'Point the relationship at a different element, or remove it.',
      });
    }
    const sourceType = elements.get(relationship.source);
    const targetType = elements.get(relationship.target);
    if (!sourceType || !targetType) {
      issues.push({
        severity: 'error',
        rule: 'relationship.dangling',
        entityId: relationship.id,
        message: `Relationship ${relationship.id} references a missing element`,
      });
      continue;
    }
    if (!getRelationshipType(relationship.type)) {
      issues.push({
        severity: 'warning',
        rule: 'relationship.unknown-type',
        entityId: relationship.id,
        message: `Relationship type "${relationship.type}" is not in the ArchiMate 3.2 metamodel`,
      });
    } else if (!isAllowedRelationship(relationship.type, sourceType, targetType)) {
      issues.push({
        severity: 'warning',
        rule: 'relationship.not-allowed',
        entityId: relationship.id,
        message: `${relationship.type} is not normally allowed from ${sourceType} to ${targetType}`,
      });
    }
  }

  for (const view of model.views) {
    if (!primaryText(view.name)) {
      issues.push({
        severity: 'info',
        rule: 'view.name',
        entityId: view.id,
        message: 'A view has no name',
      });
    }
    for (const node of view.nodes) {
      if (node.elementRef && !elements.has(node.elementRef)) {
        issues.push({
          severity: 'error',
          rule: 'view.dangling-element-ref',
          entityId: node.id,
          message: `View node ${node.id} references missing element ${node.elementRef}`,
        });
      }
      if (!node.elementRef && primaryText(node.label).length === 0) {
        issues.push({
          severity: 'info',
          rule: 'view.anonymous-node',
          entityId: node.id,
          message: 'A view node has no element reference or label',
        });
      }
    }
    for (const edge of view.edges) {
      if (!relationshipIds.has(edge.relationshipRef)) {
        issues.push({
          severity: 'error',
          rule: 'view.dangling-relationship-ref',
          entityId: edge.id,
          message: `View edge ${edge.id} references missing relationship ${edge.relationshipRef}`,
        });
      }
    }
  }

  if (model.elements.length === 0) {
    issues.push({ severity: 'info', rule: 'model.empty', message: 'The model has no elements' });
  }

  if (options.strict) {
    for (const issue of issues) {
      if (issue.severity === 'warning' && issue.rule.startsWith('element.')) {
        issue.severity = 'error';
      }
    }
  }

  return issues;
}

export function createSampleModel(): import('./types').Model {
  const el = (
    id: string,
    type: string,
    name: string,
    extra: Partial<import('./types').ArchiElement> = {},
  ) => ({
    id,
    type,
    name: [{ lang: 'en', value: name }],
    documentation: [],
    properties: [],
    ...extra,
  });
  const rel = (id: string, type: string, source: string, target: string, name = '') => ({
    id,
    type,
    source,
    target,
    name: name ? [{ lang: 'en', value: name }] : [],
    documentation: [],
    properties: [],
  });

  const domains = [
    { id: 'domain-business', name: 'Business', color: '#2563eb' },
    { id: 'domain-application', name: 'Application', color: '#0891b2' },
    { id: 'domain-technology', name: 'Technology', color: '#16a34a' },
  ];

  const elements = [
    el('e-customer', 'BusinessActor', 'Customer', { domain: 'domain-business' }),
    el('e-claim', 'BusinessProcess', 'Handle claim', { domain: 'domain-business' }),
    el('e-insurance', 'BusinessService', 'Insurance service', { domain: 'domain-business' }),
    el('e-portal', 'ApplicationComponent', 'Claims Portal', {
      domain: 'domain-application',
      environment: 'prod',
      properties: [
        { key: 'version', value: '2.4.1' },
        { key: 'owner', value: 'Claims team' },
        { key: 'criticality', value: 'high' },
      ],
    }),
    el('e-portal-api', 'ApplicationService', 'Claims API', { domain: 'domain-application' }),
    el('e-claim-data', 'DataObject', 'Claim record', {
      domain: 'domain-application',
      properties: [{ key: 'classification', value: 'confidential' }],
    }),
    el('e-billing', 'ApplicationComponent', 'Billing', {
      domain: 'domain-application',
      environment: 'prod',
      properties: [
        { key: 'version', value: '1.8.0' },
        { key: 'owner', value: 'Finance IT' },
        { key: 'criticality', value: 'medium' },
      ],
    }),
    el('e-customer-record', 'DataObject', 'Customer record', { domain: 'domain-application' }),
    el('e-server', 'Node', 'Application server', {
      domain: 'domain-technology',
      environment: 'prod',
      properties: [
        { key: 'ip', value: '10.0.1.10' },
        { key: 'version', value: 'Ubuntu 24.04' },
        { key: 'owner', value: 'Platform team' },
      ],
    }),
    el('e-db-server', 'Node', 'Database server', {
      domain: 'domain-technology',
      environment: 'prod',
      properties: [
        { key: 'ip', value: '10.0.2.20' },
        { key: 'version', value: 'PostgreSQL 17' },
        { key: 'owner', value: 'Platform team' },
      ],
    }),
    el('e-datacenter', 'Node', 'Primary datacenter', {
      domain: 'domain-technology',
      environment: 'prod',
      properties: [
        { key: 'location', value: 'Oslo' },
        { key: 'owner', value: 'Infrastructure' },
      ],
    }),
    el('e-db', 'Artifact', 'claims.db', {
      domain: 'domain-technology',
      environment: 'prod',
      properties: [{ key: 'version', value: 'PostgreSQL 17' }],
    }),
    el('e-portal-artifact', 'Artifact', 'claims-portal-2.4.1.jar', {
      domain: 'domain-technology',
      environment: 'prod',
      properties: [{ key: 'version', value: '2.4.1' }],
    }),
  ];
  const relationships = [
    rel('r-assign-1', 'Assignment', 'e-customer', 'e-claim'),
    rel('r-serve-1', 'Serving', 'e-insurance', 'e-customer', 'provides cover'),
    rel('r-real-1', 'Realization', 'e-portal', 'e-insurance'),
    rel('r-serve-2', 'Serving', 'e-portal-api', 'e-claim'),
    rel('r-access-1', 'Access', 'e-portal', 'e-claim-data'),
    rel('r-assign-2', 'Assignment', 'e-portal', 'e-portal-api'),
    rel('r-serve-3', 'Serving', 'e-server', 'e-portal'),
    rel('r-serve-4', 'Serving', 'e-db-server', 'e-db'),
    rel('r-serve-5', 'Serving', 'e-billing', 'e-db-server'),
    rel('r-serve-6', 'Serving', 'e-portal', 'e-billing'),
    rel('r-access-2', 'Access', 'e-billing', 'e-customer-record'),
    rel('r-real-2', 'Realization', 'e-portal-artifact', 'e-portal'),
    rel('r-comp-1', 'Composition', 'e-datacenter', 'e-server'),
    rel('r-comp-2', 'Composition', 'e-datacenter', 'e-db-server'),
  ];

  const nodeInfo: Array<[string, string, number, number]> = [
    ['n1', 'e-customer', 40, 80],
    ['n2', 'e-claim', 260, 80],
    ['n3', 'e-insurance', 480, 80],
    ['n4', 'e-portal', 260, 260],
    ['n5', 'e-portal-api', 480, 260],
    ['n6', 'e-claim-data', 700, 260],
    ['n7', 'e-server', 260, 440],
    ['n8', 'e-db', 480, 440],
  ];
  const edgeInfo: Array<[string, string, string, string]> = [
    ['ed1', 'r-assign-1', 'n1', 'n2'],
    ['ed2', 'r-serve-1', 'n3', 'n1'],
    ['ed3', 'r-real-1', 'n4', 'n3'],
    ['ed4', 'r-serve-2', 'n5', 'n2'],
    ['ed5', 'r-access-1', 'n4', 'n6'],
  ];

  return {
    id: 'sample-model',
    name: [{ lang: 'en', value: 'Sample insurance model' }],
    documentation: [
      { lang: 'en', value: 'A tiny ArchiMate example with business, application, and technology domains.' },
    ],
    properties: [],
    propertyDefinitions: [],
    purpose: 'as-is',
    status: 'active',
    owner: 'You',
    tags: ['sample', 'insurance'],
    domains,
    artefacts: [
      {
        id: 'artefact-sample-adr',
        kind: 'adr',
        title: 'ADR-001 Keep claims data in the portal',
        body: '## Context\n\nThe claims portal needs a record of each claim.\n\n## Decision\n\nStore claim records in the portal database for now.\n\n## Consequences\n\nSimple to operate; revisit when volumes grow.',
        status: 'accepted',
        elementIds: ['e-portal', 'e-claim-data'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    approvals: [],
    createdAt: new Date().toISOString(),
    elements,
    relationships,
    views: [
      {
        id: 'view-overview',
        type: 'Diagram',
        name: [{ lang: 'en', value: 'Overview' }],
        nodes: nodeInfo.map(([id, elementRef, x, y]) => ({
          id,
          type: 'Element',
          elementRef,
          label: [],
          bounds: { x, y, w: 170, h: 64 },
        })),
        edges: edgeInfo.map(([id, relationshipRef, source, target]) => ({
          id,
          type: 'Relationship',
          relationshipRef,
          source,
          target,
          bendpoints: [],
        })),
      },
    ],
  };
}
