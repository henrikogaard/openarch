import { getRelationshipType, primaryText } from '@openarch/core';
import type { Model, ViewNode } from '@openarch/core';

/** Reduce an arbitrary identifier to the characters Mermaid accepts. */
function sanitizeId(value: string): string {
  const replaced = value.replace(/[^A-Za-z0-9_]/g, '_');
  const safe = /^[0-9]/.test(replaced) ? `_${replaced}` : replaced;
  return safe || 'node';
}

/** Escape a string for use inside a quoted Mermaid label. */
function escapeLabel(value: string): string {
  return value.replace(/"/g, '#quot;').replace(/[\r\n]+/g, ' ');
}

/** Resolve the human-readable label of a view node. */
function nodeLabel(model: Model, node: ViewNode): string {
  if (node.elementRef) {
    const element = model.elements.find((candidate) => candidate.id === node.elementRef);
    if (element) return primaryText(element.name);
  }
  return primaryText(node.label);
}

/**
 * Export a single view as a Mermaid `flowchart LR` diagram.
 * Node ids are the (sanitized) view node ids; edges carry relationship types.
 */
export function exportMermaid(model: Model, viewId: string): string {
  const view = model.views.find((candidate) => candidate.id === viewId);
  if (!view) return 'flowchart LR';

  const nodeById = new Map(view.nodes.map((node) => [node.id, node]));
  const lines: string[] = ['flowchart LR'];

  for (const node of view.nodes) {
    const id = sanitizeId(node.id);
    const label = escapeLabel(nodeLabel(model, node) || node.id);
    lines.push(`  ${id}["${label}"]`);
  }

  for (const edge of view.edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) continue;
    const from = sanitizeId(source.id);
    const to = sanitizeId(target.id);
    const relationship = model.relationships.find(
      (candidate) => candidate.id === edge.relationshipRef,
    );
    const typeId = relationship?.type ?? '';
    const label = escapeLabel(getRelationshipType(typeId)?.label ?? typeId);
    lines.push(label ? `  ${from} -->|${label}| ${to}` : `  ${from} --> ${to}`);
  }

  return lines.join('\n');
}
