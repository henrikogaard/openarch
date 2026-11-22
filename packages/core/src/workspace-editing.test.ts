import { describe, expect, it } from 'vitest';
import { createSampleModel, validateModel } from './validation';
import {
  alignNodes,
  assignElements,
  distributeNodes,
  duplicateElements,
  elementRefsForNodes,
  groupNodes,
  reconnectRelationship,
  relationshipRefsForEdges,
  removeElements,
  removeRelationships,
  setEdgeBendpoints,
  setNodeZOrder,
  ungroupNodes,
} from './workspace';

describe('canvas editing helpers', () => {
  it('resolves node and edge ids to element/relationship refs across all views', () => {
    const model = createSampleModel();
    expect(elementRefsForNodes(model, ['n1', 'n4', 'unknown'])).toEqual(['e-customer', 'e-portal']);
    expect(relationshipRefsForEdges(model, ['ed1', 'ed3'])).toEqual(['r-assign-1', 'r-real-1']);
  });

  it('removeElements deletes the element, its relationships, view nodes/edges, and artefact links', () => {
    const model = createSampleModel();
    const next = removeElements(model, ['e-portal']);

    expect(next.elements.some((element) => element.id === 'e-portal')).toBe(false);
    expect(next.relationships.some((r) => r.source === 'e-portal' || r.target === 'e-portal')).toBe(false);
    expect(validateModel(next).some((issue) => issue.rule === 'relationship.dangling')).toBe(false);

    const view = next.views[0];
    expect(view.nodes.some((node) => node.id === 'n4')).toBe(false);
    expect(view.edges.some((edge) => edge.source === 'n4' || edge.target === 'n4')).toBe(false);
    expect(view.nodes.some((node) => node.id === 'n1')).toBe(true);
    expect(view.edges.some((edge) => edge.id === 'ed1')).toBe(true);
    expect(next.artefacts?.[0].elementIds).toEqual(['e-claim-data']);

    // The input model is not mutated.
    expect(model.elements.some((element) => element.id === 'e-portal')).toBe(true);
    expect(model.views[0].nodes.some((node) => node.id === 'n4')).toBe(true);
  });

  it('removeElements is a no-op for unknown ids', () => {
    const model = createSampleModel();
    expect(removeElements(model, ['nope'])).toBe(model);
  });

  it('removeRelationships deletes the relationship and only its view edges', () => {
    const model = createSampleModel();
    const next = removeRelationships(model, ['r-assign-1']);

    expect(next.relationships.some((r) => r.id === 'r-assign-1')).toBe(false);
    expect(next.views[0].edges.some((edge) => edge.id === 'ed1')).toBe(false);
    expect(next.views[0].edges.some((edge) => edge.id === 'ed2')).toBe(true);
    expect(next.elements.length).toBe(model.elements.length);
    expect(next.views[0].nodes.length).toBe(model.views[0].nodes.length);
    expect(removeRelationships(model, [])).toBe(model);
  });

  it('assignElements patches only the selected elements', () => {
    const model = createSampleModel();
    const next = assignElements(model, ['e-portal', 'e-billing'], {
      domain: 'domain-business',
      environment: undefined,
    });

    expect(next.elements.find((e) => e.id === 'e-portal')?.domain).toBe('domain-business');
    expect(next.elements.find((e) => e.id === 'e-portal')?.environment).toBeUndefined();
    expect(next.elements.find((e) => e.id === 'e-billing')?.domain).toBe('domain-business');
    expect(next.elements.find((e) => e.id === 'e-server')?.domain).toBe('domain-technology');
    expect(next.elements.find((e) => e.id === 'e-server')?.environment).toBe('prod');
    expect(assignElements(model, [], { domain: 'x' })).toBe(model);
  });

  it('duplicateElements copies the selected subgraph with fresh ids and offset bounds', () => {
    const model = createSampleModel();
    // e-customer (n1) and e-claim (n2) are connected by r-assign-1 (ed1) in view-overview.
    const next = duplicateElements(model, ['e-customer', 'e-claim'], 'view-overview', { x: 40, y: 40 });

    expect(next.elements.length).toBe(model.elements.length + 2);
    expect(next.relationships.length).toBe(model.relationships.length + 1);

    const copyCustomer = next.elements.find((e) => e.name.some((n) => n.value === 'Customer (copy)'));
    const copyClaim = next.elements.find((e) => e.name.some((n) => n.value === 'Handle claim (copy)'));
    expect(copyCustomer).toBeTruthy();
    expect(copyClaim).toBeTruthy();
    expect(copyCustomer!.id).not.toBe('e-customer');
    expect(copyCustomer!.domain).toBe('domain-business');

    // The internal relationship was duplicated and remapped; external ones untouched.
    const copyRel = next.relationships.find((r) => r.source === copyCustomer!.id && r.target === copyClaim!.id);
    expect(copyRel).toBeTruthy();
    expect(next.relationships.filter((r) => r.type === 'Assignment').length).toBe(
      model.relationships.filter((r) => r.type === 'Assignment').length + 1,
    );

    // View nodes/edges duplicated with offset and remapped refs.
    const view = next.views[0];
    expect(view.nodes.length).toBe(model.views[0].nodes.length + 2);
    expect(view.edges.length).toBe(model.views[0].edges.length + 1);
    const n1 = model.views[0].nodes.find((n) => n.id === 'n1')!;
    const copyNode = view.nodes.find((n) => n.elementRef === copyCustomer!.id)!;
    expect(copyNode.bounds.x).toBe(n1.bounds.x + 40);
    expect(copyNode.bounds.y).toBe(n1.bounds.y + 40);
    const copyEdge = view.edges.find((e) => e.relationshipRef === copyRel!.id)!;
    expect(copyEdge.source).toBe(copyNode.id);

    // No dangling references, and the input is untouched.
    expect(validateModel(next).some((issue) => issue.rule === 'relationship.dangling')).toBe(false);
    expect(model.elements.length).toBe(next.elements.length - 2);
    expect(duplicateElements(model, ['nope'], 'view-overview')).toBe(model);
  });

  it('alignNodes aligns selected view nodes to a common edge or center', () => {
    const model = createSampleModel();
    // n1 (40,80), n2 (260,80), n4 (260,260) in view-overview.
    const left = alignNodes(model, 'view-overview', ['n1', 'n2', 'n4'], 'left');
    const xs = left.views[0].nodes.filter((n) => ['n1', 'n2', 'n4'].includes(n.id)).map((n) => n.bounds.x);
    expect(new Set(xs).size).toBe(1);
    expect(xs[0]).toBe(40);

    const bottom = alignNodes(model, 'view-overview', ['n1', 'n2', 'n4'], 'bottom');
    const bottoms = bottom.views[0].nodes
      .filter((n) => ['n1', 'n2', 'n4'].includes(n.id))
      .map((n) => n.bounds.y + n.bounds.h);
    expect(new Set(bottoms).size).toBe(1);
    expect(bottoms[0]).toBe(260 + 64);

    // Unselected nodes are untouched; no-ops return the same reference.
    expect(left.views[0].nodes.find((n) => n.id === 'n3')!.bounds.x).toBe(480);
    expect(alignNodes(model, 'view-overview', ['n1'], 'left')).toBe(model);
    expect(alignNodes(model, 'no-such-view', ['n1', 'n2'], 'left')).toBe(model);
  });

  it('distributeNodes spreads nodes evenly along an axis, extremes fixed', () => {
    const model = createSampleModel();
    // n1 x=40, n2 x=260, n6 x=700.
    const next = distributeNodes(model, 'view-overview', ['n1', 'n2', 'n6'], 'x');
    const sorted = next.views[0].nodes
      .filter((n) => ['n1', 'n2', 'n6'].includes(n.id))
      .sort((a, b) => a.bounds.x - b.bounds.x);
    expect(sorted.map((n) => n.bounds.x)).toEqual([40, 370, 700]);

    // n1 y=80, n4 y=260, n7 y=440 — already even.
    const vertical = distributeNodes(model, 'view-overview', ['n1', 'n4', 'n7'], 'y');
    const ys = vertical.views[0].nodes
      .filter((n) => ['n1', 'n4', 'n7'].includes(n.id))
      .sort((a, b) => a.bounds.y - b.bounds.y)
      .map((n) => n.bounds.y);
    expect(ys).toEqual([80, 260, 440]);

    expect(distributeNodes(model, 'view-overview', ['n1', 'n2'], 'x')).toBe(model);
  });

  it('reconnectRelationship moves the relationship and its view edge endpoints', () => {
    const model = createSampleModel();
    // r-assign-1: e-customer -> e-claim, shown as ed1 (n1 -> n2).
    const next = reconnectRelationship(model, 'r-assign-1', 'e-insurance', 'e-claim');
    const rel = next.relationships.find((r) => r.id === 'r-assign-1')!;
    expect(rel.source).toBe('e-insurance');
    expect(rel.target).toBe('e-claim');
    const edge = next.views[0].edges.find((e) => e.id === 'ed1')!;
    expect(edge.source).toBe('n3'); // e-insurance's node
    expect(edge.target).toBe('n2');
    expect(reconnectRelationship(model, 'r-assign-1', 'e-claim', 'e-claim')).toBe(model);
    expect(reconnectRelationship(model, 'nope', 'e-claim', 'e-insurance')).toBe(model);
  });

  it('setNodeZOrder moves nodes to front/back without touching others', () => {
    const model = createSampleModel();
    const front = setNodeZOrder(model, 'view-overview', ['n1', 'n2'], 'front');
    const n1 = front.views[0].nodes.find((n) => n.id === 'n1')!;
    const n3 = front.views[0].nodes.find((n) => n.id === 'n3')!;
    expect(n1.zIndex).toBe(1);
    expect(n3.zIndex).toBeUndefined();
    const back = setNodeZOrder(front, 'view-overview', ['n1'], 'back');
    expect(back.views[0].nodes.find((n) => n.id === 'n1')!.zIndex).toBe(-1);
  });

  it('groupNodes wraps members in a Group node and ungroupNodes restores them', () => {
    const model = createSampleModel();
    const grouped = groupNodes(model, 'view-overview', ['n1', 'n2']);
    const view = grouped.views[0];
    const groupNode = view.nodes[0];
    expect(groupNode.type).toBe('Container');
    expect(groupNode.groupingElementId).toBeTruthy();
    expect(view.nodes.find((n) => n.id === 'n1')!.parentId).toBe(groupNode.id);
    expect(view.nodes.find((n) => n.id === 'n2')!.parentId).toBe(groupNode.id);
    expect(view.nodes.find((n) => n.id === 'n3')!.parentId).toBeUndefined();
    expect(grouped.elements.some((e) => e.id === groupNode.groupingElementId && e.type === 'Grouping')).toBe(true);
    // Group bounds enclose the members.
    expect(groupNode.bounds.x).toBeLessThan(40);
    expect(groupNode.bounds.y).toBeLessThan(80);

    const ungrouped = ungroupNodes(grouped, 'view-overview', ['n1', 'n2']);
    expect(ungrouped.views[0].nodes.find((n) => n.id === 'n1')!.parentId).toBeUndefined();
    // The now-empty container node and its grouping element are removed.
    expect(ungrouped.views[0].nodes.some((n) => n.id === groupNode.id)).toBe(false);
    expect(ungrouped.elements.some((e) => e.id === groupNode.groupingElementId)).toBe(false);
    expect(groupNodes(model, 'view-overview', ['n1'])).toBe(model);
  });

  it('setEdgeBendpoints replaces bendpoints of one edge only', () => {
    const model = createSampleModel();
    const next = setEdgeBendpoints(model, 'view-overview', 'ed1', [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]);
    expect(next.views[0].edges.find((e) => e.id === 'ed1')!.bendpoints).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]);
    expect(next.views[0].edges.find((e) => e.id === 'ed2')!.bendpoints).toEqual([]);
    expect(setEdgeBendpoints(model, 'view-overview', 'nope', [])).toBe(model);
  });
});
