import { describe, expect, it } from 'vitest';
import { createSampleModel, validateModel } from './validation';
import {
  assignElements,
  duplicateElements,
  elementRefsForNodes,
  relationshipRefsForEdges,
  removeElements,
  removeRelationships,
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
});
