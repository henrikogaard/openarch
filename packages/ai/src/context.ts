import {
  LAYER_LABELS,
  LAYER_ORDER,
  getElementType,
  getRelationshipType,
  primaryText,
  type ArchiElement,
  type Layer,
  type Model,
  type Relationship,
  type View,
} from '@openarch/core';

/** Appended when a rendered context exceeds the requested character budget. */
export const TRUNCATION_MARKER = '\n\n… [truncated]';

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 0) return '';
  if (maxChars <= TRUNCATION_MARKER.length) return TRUNCATION_MARKER.slice(0, maxChars);
  return text.slice(0, maxChars - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
}

function elementName(element: ArchiElement | undefined): string {
  if (!element) return '(missing element)';
  return primaryText(element.name) || element.id;
}

function relationshipLabel(relationship: Relationship, model: Model): string {
  const type = getRelationshipType(relationship.type)?.label ?? relationship.type;
  const source = elementName(model.elements.find((element) => element.id === relationship.source));
  const target = elementName(model.elements.find((element) => element.id === relationship.target));
  const name = primaryText(relationship.name);
  return `${type} — ${source} → ${target}${name ? ` (${name})` : ''}`;
}

function layerOf(element: ArchiElement): Layer {
  return getElementType(element.type)?.layer ?? 'other';
}

/**
 * Render a whole model as compact, information-dense Markdown suitable for an
 * LLM context window. Output is deterministic so identical models render alike.
 */
export function modelToMarkdown(model: Model, maxChars = 24000): string {
  const lines: string[] = [];
  const name = primaryText(model.name) || 'Untitled model';
  lines.push(`# ${name}`, '');
  lines.push(
    `- Elements: ${model.elements.length}`,
    `- Relationships: ${model.relationships.length}`,
    `- Views: ${model.views.length}`,
    '',
  );

  const documentation = primaryText(model.documentation);
  if (documentation) lines.push(documentation, '');

  for (const layer of LAYER_ORDER) {
    const elements = model.elements.filter((element) => layerOf(element) === layer);
    if (elements.length === 0) continue;
    lines.push(`## ${LAYER_LABELS[layer]} layer (${elements.length})`, '');
    for (const element of elements) {
      const label = getElementType(element.type)?.label ?? element.type;
      lines.push(`- \`${element.id}\` — ${label} (\`${element.type}\`) — **${elementName(element)}**`);
    }
    lines.push('');
  }

  lines.push(`## Relationships (${model.relationships.length})`, '');
  if (model.relationships.length === 0) {
    lines.push('_None_', '');
  } else {
    for (const relationship of model.relationships) {
      lines.push(`- \`${relationship.id}\` — ${relationshipLabel(relationship, model)}`);
    }
    lines.push('');
  }

  lines.push(`## Views (${model.views.length})`, '');
  if (model.views.length === 0) {
    lines.push('_None_', '');
  } else {
    for (const view of model.views) {
      lines.push(`### ${primaryText(view.name) || view.id} (\`${view.id}\`, ${view.type})`, '');
      lines.push(`Nodes (${view.nodes.length}):`);
      for (const node of view.nodes) {
        const ref = node.elementRef
          ? elementName(model.elements.find((element) => element.id === node.elementRef))
          : primaryText(node.label) || '(unlabelled)';
        const { x, y, w, h } = node.bounds;
        lines.push(`- \`${node.id}\` → ${ref} [${node.type}] @ (${x}, ${y}, ${w}×${h})`);
      }
      lines.push('');
      lines.push(`Edges (${view.edges.length}):`);
      for (const edge of view.edges) {
        const relationship = model.relationships.find((item) => item.id === edge.relationshipRef);
        const label = relationship
          ? getRelationshipType(relationship.type)?.label ?? relationship.type
          : edge.type;
        lines.push(`- \`${edge.id}\` ${label}: \`${edge.source}\` → \`${edge.target}\``);
      }
      lines.push('');
    }
  }

  return truncate(lines.join('\n').trimEnd(), maxChars);
}

/** Render one element together with its direct incoming and outgoing relationships. */
export function elementToMarkdown(model: Model, elementId: string): string {
  const element = model.elements.find((item) => item.id === elementId);
  if (!element) return `Element not found: ${elementId}`;

  const definition = getElementType(element.type);
  const lines: string[] = [
    `# ${elementName(element)}`,
    '',
    `- Id: \`${element.id}\``,
    `- Type: ${definition?.label ?? element.type} (\`${element.type}\`)`,
    `- Layer: ${definition ? LAYER_LABELS[definition.layer] : 'unknown'}`,
  ];

  const documentation = primaryText(element.documentation);
  if (documentation) lines.push('', documentation);

  if (element.properties.length) {
    lines.push('', 'Properties:');
    for (const property of element.properties) {
      lines.push(`- ${property.key}: ${property.value}`);
    }
  }

  const outgoing = model.relationships.filter((relationship) => relationship.source === elementId);
  const incoming = model.relationships.filter((relationship) => relationship.target === elementId);

  lines.push('', `## Outgoing relationships (${outgoing.length})`);
  if (outgoing.length === 0) lines.push('_None_');
  for (const relationship of outgoing) {
    const other = model.elements.find((item) => item.id === relationship.target);
    const type = getRelationshipType(relationship.type)?.label ?? relationship.type;
    lines.push(`- ${type} → ${elementName(other)} (\`${relationship.id}\`)`);
  }

  lines.push('', `## Incoming relationships (${incoming.length})`);
  if (incoming.length === 0) lines.push('_None_');
  for (const relationship of incoming) {
    const other = model.elements.find((item) => item.id === relationship.source);
    const type = getRelationshipType(relationship.type)?.label ?? relationship.type;
    lines.push(`- ${type} ← ${elementName(other)} (\`${relationship.id}\`)`);
  }

  return lines.join('\n');
}

/** Render a view's nodes and edges as a readable list. */
export function viewToMarkdown(model: Model, viewId: string): string {
  const view: View | undefined = model.views.find((item) => item.id === viewId);
  if (!view) return `View not found: ${viewId}`;

  const lines: string[] = [
    `# ${primaryText(view.name) || view.id}`,
    '',
    `- Id: \`${view.id}\``,
    `- Type: ${view.type}`,
    `- Nodes: ${view.nodes.length}`,
    `- Edges: ${view.edges.length}`,
    '',
    '## Nodes',
  ];
  if (view.nodes.length === 0) lines.push('_None_');
  for (const node of view.nodes) {
    const ref = node.elementRef
      ? elementName(model.elements.find((element) => element.id === node.elementRef))
      : primaryText(node.label) || '(unlabelled)';
    lines.push(`- \`${node.id}\` — ${ref} (\`${node.type}\`) @ (${node.bounds.x}, ${node.bounds.y})`);
  }

  lines.push('', '## Edges');
  if (view.edges.length === 0) lines.push('_None_');
  for (const edge of view.edges) {
    const relationship = model.relationships.find((item) => item.id === edge.relationshipRef);
    const label = relationship
      ? getRelationshipType(relationship.type)?.label ?? relationship.type
      : edge.type;
    lines.push(`- \`${edge.id}\` — ${label}: \`${edge.source}\` → \`${edge.target}\``);
  }

  return lines.join('\n');
}

/** Quote a scalar when YAML would otherwise misread it (colon, hash, or blank). */
function yamlScalar(value: string): string {
  if (
    value.length === 0 ||
    /[:#\n\r"'[\]{}&*!|>%@`]/.test(value) ||
    value.trim() !== value ||
    /^(?:true|false|null|yes|no|~|-|\d+(?:\.\d+)?)$/i.test(value)
  ) {
    return JSON.stringify(value);
  }
  return value;
}

/**
 * Hand-rolled YAML-ish representation of a model. No external dependency and
 * no DOM access, so it is safe in the browser, Node, and the MCP server.
 */
export function modelToYaml(model: Model): string {
  const lines: string[] = [];
  const pushList = (values: Array<{ lang?: string; value: string }>, indent: string): void => {
    if (values.length === 0) {
      lines.push(`${indent}[]`);
      return;
    }
    for (const item of values) {
      lines.push(`${indent}- value: ${yamlScalar(item.value)}`);
      if (item.lang) lines.push(`${indent}  lang: ${yamlScalar(item.lang)}`);
    }
  };

  lines.push('model:');
  lines.push(`  id: ${yamlScalar(model.id)}`);
  lines.push(`  name: ${yamlScalar(primaryText(model.name))}`);

  lines.push('  elements:');
  if (model.elements.length === 0) {
    lines[lines.length - 1] += ' []';
  } else {
    for (const element of model.elements) {
      lines.push(`    - id: ${yamlScalar(element.id)}`);
      lines.push(`      type: ${yamlScalar(element.type)}`);
      lines.push(`      name: ${yamlScalar(primaryText(element.name))}`);
      lines.push('      documentation:');
      pushList(element.documentation, '        ');
      lines.push('      properties:');
      if (element.properties.length === 0) {
        lines[lines.length - 1] += ' []';
      } else {
        for (const property of element.properties) {
          lines.push(`        - key: ${yamlScalar(property.key)}`);
          lines.push(`          value: ${yamlScalar(property.value)}`);
        }
      }
    }
  }

  lines.push('  relationships:');
  if (model.relationships.length === 0) {
    lines[lines.length - 1] += ' []';
  } else {
    for (const relationship of model.relationships) {
      lines.push(`    - id: ${yamlScalar(relationship.id)}`);
      lines.push(`      type: ${yamlScalar(relationship.type)}`);
      lines.push(`      source: ${yamlScalar(relationship.source)}`);
      lines.push(`      target: ${yamlScalar(relationship.target)}`);
      lines.push(`      name: ${yamlScalar(primaryText(relationship.name))}`);
    }
  }

  lines.push('  views:');
  if (model.views.length === 0) {
    lines[lines.length - 1] += ' []';
  } else {
    for (const view of model.views) {
      lines.push(`    - id: ${yamlScalar(view.id)}`);
      lines.push(`      type: ${yamlScalar(view.type)}`);
      lines.push(`      name: ${yamlScalar(primaryText(view.name))}`);
      lines.push('      nodes:');
      if (view.nodes.length === 0) {
        lines[lines.length - 1] += ' []';
      } else {
        for (const node of view.nodes) {
          lines.push(`        - id: ${yamlScalar(node.id)}`);
          lines.push(`          type: ${yamlScalar(node.type)}`);
          if (node.elementRef) lines.push(`          elementRef: ${yamlScalar(node.elementRef)}`);
          lines.push(
            `          bounds: {x: ${node.bounds.x}, y: ${node.bounds.y}, w: ${node.bounds.w}, h: ${node.bounds.h}}`,
          );
        }
      }
      lines.push('      edges:');
      if (view.edges.length === 0) {
        lines[lines.length - 1] += ' []';
      } else {
        for (const edge of view.edges) {
          lines.push(`        - id: ${yamlScalar(edge.id)}`);
          lines.push(`          relationshipRef: ${yamlScalar(edge.relationshipRef)}`);
          lines.push(`          source: ${yamlScalar(edge.source)}`);
          lines.push(`          target: ${yamlScalar(edge.target)}`);
        }
      }
    }
  }

  return `${lines.join('\n')}\n`;
}
