import { getElementType, primaryText } from '@openarch/core';
import type { Model } from '@openarch/core';

/** Quote a single CSV cell when it contains a comma, quote, or newline. */
function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Join a header and rows into a CSV document. */
function toCsv(header: string[], rows: string[][]): string {
  return [header, ...rows]
    .map((row) => row.map(csvCell).join(','))
    .join('\n');
}

/** Export all elements of a model as CSV. */
export function exportElementsCsv(model: Model): string {
  const header = ['id', 'type', 'name', 'layer', 'documentation'];
  const rows = model.elements.map((element) => [
    element.id,
    element.type,
    primaryText(element.name),
    getElementType(element.type)?.layer ?? 'other',
    primaryText(element.documentation),
  ]);
  return toCsv(header, rows);
}

/** Export all relationships of a model as CSV. */
export function exportRelationshipsCsv(model: Model): string {
  const header = ['id', 'type', 'source', 'target', 'name'];
  const rows = model.relationships.map((relationship) => [
    relationship.id,
    relationship.type,
    relationship.source,
    relationship.target,
    primaryText(relationship.name),
  ]);
  return toCsv(header, rows);
}
