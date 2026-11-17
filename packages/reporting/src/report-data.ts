import {
  LAYER_LABELS,
  LAYER_ORDER,
  domainStats,
  getElementType,
  getRelationshipType,
  primaryText,
  timeClassification,
  validateModel,
  validateWorkspace,
} from '@openarch/core';
import type {
  ArchiElement,
  Layer,
  Model,
  PortfolioStats,
  TimeClassification,
  ValidationIssue,
  WorkspaceStatus,
} from '@openarch/core';

/** Shared, deterministic projections used by both the Markdown and HTML reports. */

export const TIME_CLASSIFICATIONS: TimeClassification[] = [
  'tolerate',
  'invest',
  'migrate',
  'eliminate',
];

export const TIME_LABELS: Record<TimeClassification, string> = {
  tolerate: 'Tolerate',
  invest: 'Invest',
  migrate: 'Migrate',
  eliminate: 'Eliminate',
};

const STATUS_ORDER: WorkspaceStatus[] = ['draft', 'active', 'approved', 'archived'];

export interface DomainGroup {
  key: string;
  name: string;
  elements: ArchiElement[];
}

export interface ElementGroup {
  layer: Layer;
  label: string;
  domains: DomainGroup[];
}

export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function workspaceName(model: Model): string {
  return primaryText(model.name).trim() || 'Untitled workspace';
}

export function elementLabel(element: ArchiElement | undefined, fallback: string): string {
  if (!element) return fallback;
  return primaryText(element.name).trim() || element.id || fallback;
}

export function elementTypeLabel(type: string): string {
  return getElementType(type)?.label ?? type;
}

export function metadataRows(model: Model): string[][] {
  return [
    ['Purpose', model.purpose ?? 'as-is'],
    ['Status', model.status ?? 'draft'],
    ['Owner', model.owner?.trim() || '—'],
    ['Tags', (model.tags ?? []).join(', ') || '—'],
    ['Elements', String(model.elements.length)],
    ['Relationships', String(model.relationships.length)],
    ['Domains', String(model.domains?.length ?? 0)],
    ['Views', String(model.views.length)],
    ['Artefacts', String(model.artefacts?.length ?? 0)],
    ['Updated', model.updatedAt ?? '—'],
  ];
}

export function domainRows(model: Model): string[][] {
  return domainStats(model).map(({ domain, elementCount, relationshipCount, crossDomainCount }) => [
    domain.name,
    domain.owner?.trim() || '—',
    String(elementCount),
    String(relationshipCount),
    String(crossDomainCount),
  ]);
}

/**
 * Group elements by layer, then by domain. Domain order follows the workspace
 * domain list; unknown domains are sorted; unassigned elements come last.
 */
export function elementGroups(model: Model): ElementGroup[] {
  const byLayer = new Map<Layer, Map<string, ArchiElement[]>>();

  for (const element of model.elements) {
    const layer = getElementType(element.type)?.layer ?? 'other';
    let domains = byLayer.get(layer);
    if (!domains) {
      domains = new Map<string, ArchiElement[]>();
      byLayer.set(layer, domains);
    }
    const key = element.domain?.trim() ?? '';
    const list = domains.get(key);
    if (list) {
      list.push(element);
    } else {
      domains.set(key, [element]);
    }
  }

  const domainOrder = (model.domains ?? []).map((domain) => domain.id);
  const domainNames = new Map((model.domains ?? []).map((domain) => [domain.id, domain.name]));
  const groups: ElementGroup[] = [];

  for (const layer of LAYER_ORDER) {
    const domains = byLayer.get(layer);
    if (!domains || domains.size === 0) continue;

    const keys = [...domains.keys()];
    const orderedKeys = [
      ...domainOrder.filter((id) => domains.has(id)),
      ...keys.filter((key) => key !== '' && !domainOrder.includes(key)).sort(compareText),
      ...(domains.has('') ? [''] : []),
    ];

    groups.push({
      layer,
      label: LAYER_LABELS[layer],
      domains: orderedKeys.map((key) => ({
        key,
        name:
          key === ''
            ? 'Unassigned'
            : (domainNames.get(key) ?? '').trim() || key,
        elements: [...(domains.get(key) ?? [])].sort((a, b) => {
          return (
            compareText(primaryText(a.name), primaryText(b.name)) || compareText(a.id, b.id)
          );
        }),
      })),
    });
  }

  return groups;
}

export function relationshipRows(model: Model): string[][] {
  const elementById = new Map(model.elements.map((element) => [element.id, element]));
  return model.relationships.map((relationship) => {
    const source = elementLabel(elementById.get(relationship.source), relationship.source);
    const target = elementLabel(elementById.get(relationship.target), relationship.target);
    return [
      getRelationshipType(relationship.type)?.label ?? relationship.type,
      `${source} → ${target}`,
    ];
  });
}

export function validationIssues(model: Model): ValidationIssue[] {
  return [...validateModel(model), ...validateWorkspace(model)];
}

export function validationCounts(
  issues: ValidationIssue[],
): Record<ValidationIssue['severity'], number> {
  const counts: Record<ValidationIssue['severity'], number> = {
    error: 0,
    warning: 0,
    info: 0,
  };
  for (const issue of issues) counts[issue.severity] += 1;
  return counts;
}

export function portfolioSummaryRows(stats: PortfolioStats): string[][] {
  return [
    ['Workspaces', String(stats.workspaces)],
    ['Elements', String(stats.elements)],
    ['Relationships', String(stats.relationships)],
    ['Domains', String(stats.domains)],
    ['Artefacts', String(stats.artefacts)],
  ];
}

export function statusRows(byStatus: Record<WorkspaceStatus, number>): string[][] {
  return STATUS_ORDER.map((status) => [status, String(byStatus[status])]);
}

export function purposeRows(byPurpose: Record<string, number>): string[][] {
  return Object.keys(byPurpose)
    .sort(compareText)
    .map((purpose) => [purpose, String(byPurpose[purpose])]);
}

export function timeSummaryRows(stats: PortfolioStats): string[][] {
  return TIME_CLASSIFICATIONS.map((classification) => [
    TIME_LABELS[classification],
    String(stats.time[classification]),
  ]);
}

export function portfolioWorkspaceRows(models: Model[]): string[][] {
  return models.map((model) => [
    workspaceName(model),
    model.purpose ?? 'as-is',
    model.status ?? 'draft',
    model.owner?.trim() || '—',
    String(model.elements.length),
    String(model.domains?.length ?? 0),
    String(model.artefacts?.length ?? 0),
    model.updatedAt ?? '—',
  ]);
}

export function applicationComponentTimeRows(models: Model[]): string[][] {
  const rows: string[][] = [];
  for (const model of models) {
    for (const element of model.elements) {
      if (element.type !== 'ApplicationComponent') continue;
      rows.push([
        workspaceName(model),
        elementLabel(element, element.id),
        TIME_LABELS[timeClassification(model, element.id)],
      ]);
    }
  }
  return rows;
}
