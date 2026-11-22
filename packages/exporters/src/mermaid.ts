import { getRelationshipType, primaryText } from '@openarch/core';
import type { Model, ViewNode } from '@openarch/core';

/**
 * Reduce an arbitrary identifier to the characters Mermaid accepts. Colliding
 * sanitizations (a.b vs a-b both become a_b) must stay DISTINCT nodes, so a
 * de-duplication suffix keeps the first, appends -2/-3… to the rest.
 */
function idUniquifier(): (value: string) => string {
  const seen = new Map<string, number>();
  return (value: string) => {
    const replaced = value.replace(/[^A-Za-z0-9_]/g, '_');
    const safe = /^[0-9]/.test(replaced) ? `_${replaced}` : replaced || 'node';
    const occurrence = (seen.get(safe) ?? 0) + 1;
    seen.set(safe, occurrence);
    return occurrence === 1 ? safe : `${safe}_${occurrence}`;
  };
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
  const sanitizeId = idUniquifier();
  const lines: string[] = ['flowchart LR'];
  const flowId = new Map<string, string>();

  for (const node of view.nodes) {
    const id = sanitizeId(node.id);
    flowId.set(node.id, id);
    const label = escapeLabel(nodeLabel(model, node) || node.id);
    lines.push(`  ${id}["${label}"]`);
  }

  for (const edge of view.edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) continue;
    const from = flowId.get(source.id)!;
    const to = flowId.get(target.id)!;
    const relationship = model.relationships.find(
      (candidate) => candidate.id === edge.relationshipRef,
    );
    const typeId = relationship?.type ?? '';
    const label = escapeLabel(getRelationshipType(typeId)?.label ?? typeId);
    lines.push(label ? `  ${from} -->|${label}| ${to}` : `  ${from} --> ${to}`);
  }

  return lines.join('\n');
}
