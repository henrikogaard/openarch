import { getElementType, getRelationshipType, primaryText } from '@openarch/core';
import type { Model, View, ViewEdge, ViewNode } from '@openarch/core';

/** A rectangular region expressed in a view's own coordinate system. */
interface DiagramBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Escape a value for inclusion in XML text or attributes. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Compute the padded bounding box that encloses every node in a view. */
function contentBounds(nodes: ViewNode[], padding: number): DiagramBounds {
  if (nodes.length === 0) {
    // Graceful fallback for empty views: a normal, drawable canvas.
    return { x: 0, y: 0, w: 800, h: 600 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    const { x, y, w, h } = node.bounds;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  }
  return {
    x: minX - padding,
    y: minY - padding,
    w: maxX - minX + padding * 2,
    h: maxY - minY + padding * 2,
  };
}

/** The reusable arrowhead marker referenced by edge lines. */
function markerDefs(id: string): string {
  return (
    `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" ` +
    `markerWidth="6" markerHeight="6" orient="auto-start-reverse">` +
    `<path d="M 0 0 L 10 5 L 0 10 z" fill="#333"/></marker>`
  );
}

/** Render a single view node: a colored rectangle for elements, text otherwise. */
function renderNode(model: Model, node: ViewNode): string {
  const { x, y, w, h } = node.bounds;
  if (node.elementRef) {
    const element = model.elements.find((candidate) => candidate.id === node.elementRef);
    if (element) {
      const definition = getElementType(element.type);
      const color = definition?.color ?? '#ffffff';
      const letter = escapeXml(definition?.letter ?? '?');
      const name = escapeXml(primaryText(element.name));
      return [
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" ` +
          `fill="${color}" stroke="#333" stroke-width="1"/>`,
        `<text x="${x + 6}" y="${y + 14}" font-size="11" font-weight="bold" ` +
          `fill="#333">${letter}</text>`,
        `<text x="${x + w / 2}" y="${y + h / 2 + 4}" font-size="11" ` +
          `text-anchor="middle" fill="#111">${name}</text>`,
      ].join('\n');
    }
  }
  const label = primaryText(node.label);
  if (label) {
    return (
      `<text x="${x + w / 2}" y="${y + h / 2 + 4}" font-size="11" ` +
      `text-anchor="middle" fill="#111">${escapeXml(label)}</text>`
    );
  }
  return '';
}

/** Render one edge between the centers of its two view nodes. */
function renderEdge(
  model: Model,
  edge: ViewEdge,
  nodeById: Map<string, ViewNode>,
  markerId: string,
): string {
  const source = nodeById.get(edge.source);
  const target = nodeById.get(edge.target);
  if (!source || !target) return '';

  const sx = source.bounds.x + source.bounds.w / 2;
  const sy = source.bounds.y + source.bounds.h / 2;
  const tx = target.bounds.x + target.bounds.w / 2;
  const ty = target.bounds.y + target.bounds.h / 2;

  const relationship = model.relationships.find(
    (candidate) => candidate.id === edge.relationshipRef,
  );
  const typeId = relationship?.type ?? '';
  const definition = getRelationshipType(typeId);
  const dash = definition?.lineStyle === 'dashed' ? ' stroke-dasharray="6,4"' : '';
  const label = escapeXml(definition?.label ?? typeId);
  const midX = (sx + tx) / 2;
  const midY = (sy + ty) / 2;

  return [
    `<line x1="${sx}" y1="${sy}" x2="${tx}" y2="${ty}" stroke="#333" ` +
      `stroke-width="1.5"${dash} marker-end="url(#${markerId})"/>`,
    `<text x="${midX}" y="${midY - 4}" font-size="10" text-anchor="middle" ` +
      `fill="#333" stroke="#fff" stroke-width="3" paint-order="stroke">${label}</text>`,
  ].join('\n');
}

/** Render the contents of a single view (edges beneath nodes). */
function renderView(model: Model, view: View, markerId: string): string {
  const nodeById = new Map(view.nodes.map((node) => [node.id, node]));
  const parts: string[] = [];
  for (const edge of view.edges) {
    parts.push(renderEdge(model, edge, nodeById, markerId));
  }
  for (const node of view.nodes) {
    parts.push(renderNode(model, node));
  }
  return parts.filter((part) => part.length > 0).join('\n');
}

/**
 * Export one model view as a standalone, DOM-free SVG string.
 * Geometry comes from node bounds; viewBox is padded around them.
 */
export function exportViewSvg(
  model: Model,
  viewId: string,
  options: { padding?: number; background?: string } = {},
): string {
  const padding = options.padding ?? 20;
  const background = options.background;
  const view = model.views.find((candidate) => candidate.id === viewId);
  const bounds = contentBounds(view?.nodes ?? [], padding);
  const box = `${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`;
  const backgroundRect = background
    ? `<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.w}" ` +
      `height="${bounds.h}" fill="${escapeXml(background)}"/>`
    : '';

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}" ` +
      `width="${bounds.w}" height="${bounds.h}">`,
    `<defs>${markerDefs('arrow')}</defs>`,
    backgroundRect,
    view ? renderView(model, view, 'arrow') : '',
    '</svg>',
  ]
    .filter((part) => part.length > 0)
    .join('\n');
}

/**
 * Export every view of a model into a single SVG, stacking them vertically.
 * Each view keeps its own coordinate system via a translation group and marker.
 */
export function exportModelSvg(model: Model): string {
  const padding = 20;
  const boundsList = model.views.map((view) => contentBounds(view.nodes, padding));
  const width = boundsList.reduce((max, bounds) => Math.max(max, bounds.w), 0) || 800;
  const height = boundsList.reduce((sum, bounds) => sum + bounds.h, 0) || 600;

  let offsetY = 0;
  const groups: string[] = [];
  model.views.forEach((view, index) => {
    const bounds = boundsList[index];
    const markerId = `arrow-${index}`;
    const transform = `translate(${-bounds.x}, ${offsetY - bounds.y})`;
    groups.push(
      `<g transform="${transform}">`,
      `<defs>${markerDefs(markerId)}</defs>`,
      renderView(model, view, markerId),
      '</g>',
    );
    offsetY += bounds.h;
  });

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
      `width="${width}" height="${height}">`,
    ...groups,
    '</svg>',
  ].join('\n');
}
