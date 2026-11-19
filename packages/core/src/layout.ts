import type { Point } from '@openarch/core';

export type LayoutMode = 'grid' | 'layers';

export interface LayoutOptions {
  mode?: LayoutMode;
  origin?: Point;
  columns?: number;
  columnGap?: number;
  rowGap?: number;
  nodeWidth?: number;
  nodeHeight?: number;
}

/**
 * Deterministic layout: grid (reading order by element index) or layered
 * (nodes ordered by relationship direction — sources first, sinks last,
 * stable within a layer by id). Same input always produces the same bounds.
 */
export function layoutView(
  order: string[],
  edges: Array<{ source: string; target: string }>,
  options: LayoutOptions = {},
): Map<string, { x: number; y: number; w: number; h: number }> {
  const {
    mode = 'grid',
    origin = { x: 60, y: 80 },
    columns = 6,
    columnGap = 220,
    rowGap = 120,
    nodeWidth = 170,
    nodeHeight = 64,
  } = options;
  const result = new Map<string, { x: number; y: number; w: number; h: number }>();
  if (order.length === 0) return result;

  if (mode === 'grid') {
    order.forEach((id, index) => {
      result.set(id, {
        x: origin.x + (index % columns) * columnGap,
        y: origin.y + Math.floor(index / columns) * rowGap,
        w: nodeWidth,
        h: nodeHeight,
      });
    });
    return result;
  }

  // Layered: longest-path layering on the DAG induced by the given edges
  // (constraints aware; cycles degrade gracefully by treating any cycle
  // member beyond the depth cap as a new root).
  const layerOf = new Map<string, number>();
  const indegree = new Map<string, number>(order.map((id) => [id, 0]));
  const targetsOf = new Map<string, string[]>(order.map((id) => [id, []]));
  for (const edge of edges) {
    if (!targetsOf.has(edge.source) || !indegree.has(edge.target)) continue;
    targetsOf.get(edge.source)!.push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }
  let frontier = order.filter((id) => (indegree.get(id) ?? 0) === 0).sort();
  if (frontier.length === 0) frontier = [order[0]]; // pure cycles: break at first node
  let layer = 0;
  const placed = new Set<string>();
  while (frontier.length) {
    const currentLayer = [...frontier].sort();
    for (const id of currentLayer) {
      result.set(id, {
        x: origin.x + layer * columnGap,
        y: origin.y + (placed.size % 4) * rowGap,
        w: nodeWidth,
        h: nodeHeight,
      });
      placed.add(id);
    }
    const next: string[] = [];
    for (const id of currentLayer) {
      for (const target of targetsOf.get(id) ?? []) {
        indegree.set(target, (indegree.get(target) ?? 1) - 1);
        if ((indegree.get(target) ?? 0) <= 0 && !placed.has(target)) next.push(target);
      }
    }
    frontier = [...new Set(next)];
    layer += 1;
    if (layer > 12) break; // pathological graphs: cap depth
  }
  // Any node not reached (disconnected or cycle-locked): append in grid order.
  const rest = order.filter((id) => !placed.has(id)).sort();
  rest.forEach((id, index) => {
    const column = index % 3;
    const row = Math.floor(index / 3);
    result.set(id, {
      x: origin.x + column * columnGap,
      y: origin.y + 120 + row * rowGap,
      w: nodeWidth,
      h: nodeHeight,
    });
  });
  return result;
}
