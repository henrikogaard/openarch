import { XMLParser } from 'fast-xml-parser';
import { createModel, type ArchiElement, type Model, type Point, type Relationship, type View } from '@openarch/core';
// draw.io files are mxGraphModel XML (possibly inside an uncompressed
// <mxfile> — compressed buffers are out of scope for a first pass).

interface Cell {
  id: string;
  value?: string;
  style?: string;
  vertex?: unknown;
  edge?: unknown;
  parent?: string;
  source?: string;
  target?: string;
  mxGeometry?: { x?: string; y?: string; width?: string; height?: string; points?: unknown };
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
});

function textOf(value: string | undefined): string {
  return (value ?? '')
    // draw.io cells may carry inline HTML ("b/label"); strip tags.
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .replace(/^ | $/g, '')
    .trim();
}

function number(value: string | undefined): number {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

export interface DrawIoImportResult {
  model: Model;
  warnings: string[];
}

/**
 * Import a draw.io diagram (.drawio XML with <mxGraphModel>) as a
 * best-effort ArchiMate model: each vertex becomes an ApplicationComponent,
 * containers/borders stay elements, edges become Association relationships,
 * and the page becomes a single view carrying positions.
 */
export function importDrawIo(xml: string): DrawIoImportResult {
  const warnings: string[] = [];
  const document = parser.parse(xml) as Record<string, unknown> & { mxfile?: unknown; mxGraphModel?: unknown };
  interface MaybeModel {
    mxGraphModel?: NodeGraph | MaybeModel | Array<MaybeModel>;
    diagram?: unknown;
    root?: NodeGraph;
  }
  type NodeGraph = { root?: { mxCell?: Array<Record<string, unknown>> | Record<string, unknown> } };
  let root: NodeGraph | undefined =
    (document.mxGraphModel as NodeGraph | undefined) ??
    (() => {
      const file = document.mxfile as (MaybeModel & { diagram?: MaybeModel | Array<{ mxGraphModel?: NodeGraph }> }) | undefined;
      if (!file) return undefined;
      if (file.mxGraphModel) {
        const nested = file.mxGraphModel;
        return (Array.isArray(nested) ? (nested[0] as unknown as NodeGraph) : (nested as unknown as NodeGraph)) ?? undefined;
      }
      const diagram = file.diagram;
      const diagrams = Array.isArray(diagram) ? diagram : [diagram];
      for (const entry of diagrams) {
        const model = (entry as { mxGraphModel?: NodeGraph }).mxGraphModel;
        if (model) return model;
        // Some exports wrap it twice: mxfile.diagram.diagram.mxGraphModel (compressed binary fallback)
        const inner = (entry as unknown as MaybeModel).diagram as MaybeModel | undefined;
        if (inner?.mxGraphModel) return inner.mxGraphModel as NodeGraph;
      }
      return undefined;
    })();
  if (!root || typeof root !== 'object' || !root.root) {
    throw new Error('Not a draw.io diagram (expected <mxfile>/<mxGraphModel> with <root>)');
  }
  const rawCells = Array.isArray(root.root.mxCell)
    ? (root.root.mxCell as Array<Record<string, unknown>>)
    : [root.root.mxCell as Record<string, unknown>];
  const cells: Cell[] = rawCells.map((cell) => ({
    id: String(cell['@_id'] ?? ''),
    value: cell['@_value'] as string | undefined,
    style: cell['@_style'] as string | undefined,
    vertex: cell['@_vertex'],
    edge: cell['@_edge'],
    parent: cell['@_parent'] as string | undefined,
    source: cell['@_source'] as string | undefined,
    target: cell['@_target'] as string | undefined,
    mxGeometry: cell.mxGeometry as Cell['mxGeometry'],
  }));
  const byId = new Map(cells.map((cell) => [cell.id, cell]));
  const vertices: Cell[] = [];
  const edges: Cell[] = [];
  for (const cell of cells) {
    if (cell.id === '0' || cell.id === '1') continue; // layers = default parents
    if (cell.edge !== undefined) edges.push(cell);
    else if (cell.vertex !== undefined) vertices.push(cell);
  }

  const labelOf = (cell: Cell): string => textOf(cell.value);
  const containerOf = (cell: Cell): string | undefined => {
    const parent = cell.parent ? byId.get(String(cell.parent)) : undefined;
    if (!parent || parent.id === '1' || parent.id === '0') return undefined;
    if (parent.vertex === undefined) return undefined;
    return parent.id;
  };

  const elements: ArchiElement[] = [];
  const nodeOfElement = new Map<string, string>();
  for (const vertex of vertices) {
    const label = labelOf(vertex);
    const style = vertex.style ?? '';
    // Shape heuristic: drawer shapes 'shape=umlActor'/'shape=mxgraph…actor' → BusinessActor.
    const type = /actor|user/i.test(style) ? 'BusinessActor' : 'ApplicationComponent';
    const id = `el-${vertex.id}`;
    elements.push({
      id,
      type,
      name: [{ lang: 'en', value: label || `Shape ${vertex.id}` }],
      documentation: [],
      properties: [{ key: 'source', value: 'drawio' }, { key: 'drawioCellId', value: vertex.id }],
    });
    nodeOfElement.set(vertex.id, id);
  }

  const relationships: Relationship[] = [];
  const edgeNodes: Array<{ id: string; sourceNodeId: string; targetNodeId: string }> = [];
  for (const edge of edges) {
    const sourceRef = String(edge.source ?? '');
    const targetRef = String(edge.target ?? '');
    if (!nodeOfElement.has(sourceRef) || !nodeOfElement.has(targetRef)) {
      warnings.push(`Skipping edge ${edge.id}${labelOf(edge) ? ` (${labelOf(edge)})` : ''}: endpoint(s) are not vertices.`);
      continue;
    }
    const relationshipId = `rel-${edge.id}`;
    relationships.push({
      id: relationshipId,
      type: 'Association',
      source: nodeOfElement.get(sourceRef)!,
      target: nodeOfElement.get(targetRef)!,
      name: labelOf(edge) ? [{ lang: 'en', value: labelOf(edge) }] : [],
      documentation: [],
      properties: [],
    });
    edgeNodes.push({ id: `edge-${edge.id}`, sourceNodeId: `node-${sourceRef}`, targetNodeId: `node-${targetRef}` });
  }

  // View: two-pass grid placement using draw.io coordinates (scaled 1:1 —
  // draw.io units match canvas pixels well enough for a working view).
  let scale = 1;
  const geometryOf = (cell: Cell): Point => ({
    x: number((cell.mxGeometry as Record<string, string> | undefined)?.['@_x']) * scale,
    y: number((cell.mxGeometry as Record<string, string> | undefined)?.['@_y']) * scale,
  });
  // If the diagram is huge, scale coordinates down so the view fits on screen.
  const maxX = Math.max(0, ...vertices.map((cell, index) => { void index; return geometryOf(cell).x + number((cell.mxGeometry as Record<string, string> | undefined)?.['@_width']); }));
  scale = maxX > 6000 ? 6000 / maxX : 1;
  const view: View = {
    id: 'view-drawio',
    type: 'Diagram',
    name: [{ lang: 'en', value: 'draw.io import' }],
    nodes: vertices.map((vertex) => ({
      id: `node-${vertex.id}`,
      type: 'Element',
      elementRef: nodeOfElement.get(vertex.id)!,
      label: [],
      // Containers may be "shape=group" with size largely visual; keep every
      // vertex as a plain node at its place.
      bounds: {
        x: Math.round(geometryOf(vertex).x),
        y: Math.round(geometryOf(vertex).y),
        w: Math.max(120, Math.round(number(vertex.mxGeometry?.width as string) * scale)),
        h: Math.max(50, Math.round(number(vertex.mxGeometry?.height as string) * scale)),
      },
    })),
    edges: edgeNodes.map((edge) => ({
      id: edge.id,
      type: 'Relationship',
      relationshipRef: relationships.find((relationship) => relationship.source === nodeOfElement.get(String(edges.find((candidate) => candidate.id === edge.id.replace('edge-', ''))?.source ?? '')))?.id ?? nodeOfElement.get(String(edges.find((candidate) => candidate.id === edge.id.replace('edge-', ''))?.source ?? '')) ?? edge.sourceNodeId,
      source: edge.sourceNodeId,
      target: edge.targetNodeId,
      bendpoints: [],
    })) as View['edges'],
  };
  // Fix the edge relationshipRef mapping correctly (single pass).
  view.edges = edges
    .filter((edge) => nodeOfElement.has(String(edge.source ?? '')) && nodeOfElement.has(String(edge.target ?? '')))
    .map((edge) => {
      const sourceElement = nodeOfElement.get(String(edge.source))!;
      const targetElement = nodeOfElement.get(String(edge.target))!;
      const relationship = relationships.find(
        (candidate) => candidate.source === sourceElement && candidate.target === targetElement,
      )!;
      return {
        id: `edge-${edge.id}`,
        type: 'Relationship',
        relationshipRef: relationship.id,
        source: `node-${edge.source}`,
        target: `node-${edge.target}`,
        bendpoints: [],
      };
    });
  void edgeNodes;
  void containerOf;

  const model = createModel({
    id: `drawio-${Math.random().toString(36).slice(2, 7)}`,
    name: [{ lang: 'en', value: 'draw.io import' }],
    elements,
    relationships,
    views: [view],
  });
  return { model, warnings: [...new Set(warnings)].slice(0, 50) };
}
