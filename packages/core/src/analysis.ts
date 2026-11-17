import { getElementType } from './metamodel';
import { type ArchiElement, type Model, type Relationship, primaryText } from './types';

export interface TraceEntry {
  element: ArchiElement;
  relationship: Relationship;
  direction: 'in' | 'out';
  depth: number;
}

export interface TraceOptions {
  directions?: Array<'in' | 'out'>;
  relationshipTypes?: string[];
  maxDepth?: number;
}

export function getElementById(model: Model, id: string): ArchiElement | undefined {
  return model.elements.find((element) => element.id === id);
}

/** Walk relationships from an element, returning reachable elements with paths. */
export function traceElements(model: Model, elementId: string, options: TraceOptions = {}): TraceEntry[] {
  const directions = options.directions ?? ['in', 'out'];
  const maxDepth = options.maxDepth ?? 3;
  const types = options.relationshipTypes;
  const results: TraceEntry[] = [];
  const visited = new Set<string>([elementId]);
  let frontier = [elementId];

  for (let depth = 1; depth <= maxDepth && frontier.length; depth += 1) {
    const next: string[] = [];
    for (const current of frontier) {
      for (const relationship of model.relationships) {
        if (types && !types.includes(relationship.type)) continue;
        let otherId: string | undefined;
        let direction: 'in' | 'out' | undefined;
        if (directions.includes('out') && relationship.source === current) {
          otherId = relationship.target;
          direction = 'out';
        }
        if (directions.includes('in') && relationship.target === current) {
          otherId = relationship.source;
          direction = 'in';
        }
        if (!otherId || !direction || visited.has(otherId)) continue;
        const element = getElementById(model, otherId);
        if (!element) continue;
        visited.add(otherId);
        results.push({ element, relationship, direction, depth });
        next.push(otherId);
      }
    }
    frontier = next;
  }
  return results;
}

/** Elements that would be affected if the given element changed. */
export function impactAnalysis(model: Model, elementId: string, maxDepth = 2): TraceEntry[] {
  return traceElements(model, elementId, {
    directions: ['out'],
    relationshipTypes: ['Serving', 'Realization', 'Assignment', 'Flow', 'Triggering'],
    maxDepth,
  });
}

export interface MatrixCell {
  rowId: string;
  columnId: string;
  relationships: Relationship[];
}

export interface Matrix {
  title: string;
  rows: ArchiElement[];
  columns: ArchiElement[];
  cells: MatrixCell[];
}

export function buildMatrix(
  model: Model,
  title: string,
  rowType: string,
  columnType: string,
  relationshipTypes?: string[],
): Matrix {
  const rows = model.elements.filter((element) => element.type === rowType);
  const columns = model.elements.filter((element) => element.type === columnType);
  const rowIds = new Set(rows.map((element) => element.id));
  const columnIds = new Set(columns.map((element) => element.id));
  const cells: MatrixCell[] = [];

  for (const relationship of model.relationships) {
    if (relationshipTypes && !relationshipTypes.includes(relationship.type)) continue;
    if (rowIds.has(relationship.source) && columnIds.has(relationship.target)) {
      cells.push({ rowId: relationship.source, columnId: relationship.target, relationships: [relationship] });
    } else if (rowIds.has(relationship.target) && columnIds.has(relationship.source)) {
      cells.push({ rowId: relationship.target, columnId: relationship.source, relationships: [relationship] });
    }
  }
  return { title, rows, columns, cells };
}

export const MATRIX_PRESETS = [
  { id: 'capability-application', title: 'Capability × Application', rowType: 'Capability', columnType: 'ApplicationComponent', relationshipTypes: ['Realization', 'Serving'] },
  { id: 'process-application', title: 'Process × Application', rowType: 'BusinessProcess', columnType: 'ApplicationComponent', relationshipTypes: ['Serving', 'Realization', 'Assignment'] },
  { id: 'application-technology', title: 'Application × Technology', rowType: 'ApplicationComponent', columnType: 'Node', relationshipTypes: ['Realization', 'Assignment'] },
] as const;

export function buildPresetMatrix(model: Model, presetId: string): Matrix | undefined {
  const preset = MATRIX_PRESETS.find((item) => item.id === presetId);
  if (!preset) return undefined;
  return buildMatrix(model, preset.title, preset.rowType, preset.columnType, [...preset.relationshipTypes]);
}

export interface SearchResult {
  element: ArchiElement;
  field: string;
  snippet: string;
}

export function searchModel(model: Model, query: string): SearchResult[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const results: SearchResult[] = [];
  for (const element of model.elements) {
    const name = primaryText(element.name);
    const documentation = primaryText(element.documentation);
    const properties = element.properties.map((property) => `${property.key} ${property.value}`).join(' ');
    if (name.toLowerCase().includes(needle)) {
      results.push({ element, field: 'name', snippet: name });
    } else if (documentation.toLowerCase().includes(needle)) {
      results.push({ element, field: 'documentation', snippet: documentation.slice(0, 160) });
    } else if (properties.toLowerCase().includes(needle)) {
      results.push({ element, field: 'properties', snippet: properties.slice(0, 160) });
    }
  }
  return results;
}

export function orphanElements(model: Model): ArchiElement[] {
  const connected = new Set<string>();
  for (const relationship of model.relationships) {
    connected.add(relationship.source);
    connected.add(relationship.target);
  }
  return model.elements.filter((element) => !connected.has(element.id));
}

export function typeCounts(model: Model): Array<{ type: string; label: string; count: number; color?: string }> {
  const counts = new Map<string, number>();
  for (const element of model.elements) counts.set(element.type, (counts.get(element.type) ?? 0) + 1);
  return [...counts.entries()]
    .map(([type, count]) => ({ type, label: getElementType(type)?.label ?? type, count, color: getElementType(type)?.color }))
    .sort((a, b) => b.count - a.count);
}
