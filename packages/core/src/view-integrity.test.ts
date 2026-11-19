import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAoef, serializeAoef } from './aoef';
import { conflictEntries } from './conflict';
import { defaultConfigFor } from './granulation';
import { buildConfiguredView } from './granulation';
import { mergeModels } from './diff';
import { getElementById } from './analysis';
import {
  groupNodes,
  reconnectRelationship,
  removeElements,
  ungroupNodes,
} from './workspace';
import type { Model } from './types';
import { createSampleModel, validateModel } from './validation';

const fixture = new URL('../../../examples/archisurance.xml', import.meta.url);
const schema = new URL('../../../test/fixtures/xsd/archimate3_Diagram.xsd', import.meta.url);
const archisuranceXml = readFileSync(fixture, 'utf-8');

function hasXmllint(): boolean {
  try {
    execFileSync('xmllint', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const xmllintAvailable = hasXmllint();

function validate(xml: string): string[] {
  const directory = mkdtempSync(join(tmpdir(), 'openarch-xsd-'));
  const file = join(directory, 'model.xml');
  writeFileSync(file, xml, 'utf-8');
  try {
    execFileSync('xmllint', ['--noout', '--schema', schema.pathname, file], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return [];
  } catch (error) {
    return ((error as { stderr?: Buffer }).stderr?.toString() ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.includes('purl.org/dc') && !line.includes('No matching global element declaration') && !line.endsWith('fails to validate'));
  }
}

/** A nested-container model: group + children in a view, like real Archi files. */
function modelWithNestedContainer(): { model: Model; groupNodeId: string; groupElementId: string; childId: string } {
  let model = createSampleModel();
  model = groupNodes(model, 'view-overview', ['n1', 'n2']);
  const groupNode = model.views[0].nodes[0];
  const childId = model.views[0].nodes.find((node) => node.id === 'n1')!.id;
  return {
    model,
    groupNodeId: groupNode.id,
    groupElementId: groupNode.groupingElementId!,
    childId,
  };
}

describe.skipIf(!xmllintAvailable)('conformance regression: generated views and containers', () => {
  it('two generated views sharing elements export with unique ids and still validate', () => {
    const model = parseAoef(archisuranceXml);
    const config = defaultConfigFor('technology'); // or a solition-style config
    const one = buildConfiguredView(model, { ...config, granulation: 'L2' }, { id: 'view-gen-one' });
    const two = buildConfiguredView(model, { ...config, granulation: 'L2' }, { id: 'view-gen-two' });
    const withBoth: Model = {
      ...model,
      views: [...model.views, one.view, two.view],
    };
    const xml = serializeAoef(withBoth);
    const errors = validate(xml);
    expect(errors).toEqual([]);
  });

  it('nested container children are parsed as real nodes and survive export', () => {
    const model = parseAoef(archisuranceXml);
    // The fixture has container nodes; children must be visible as nodes with a parentId.
    const children = model.views.flatMap((view) => view.nodes.filter((node) => node.parentId));
    expect(children.length).toBeGreaterThan(0);

    const xml = serializeAoef(model);
    const errors = validate(xml);
    expect(errors).toEqual([]);
  });

  it('deleting an element that lives inside a container still exports valid AOEF', () => {
    const model = parseAoef(archisuranceXml);
    const child = model.views
      .flatMap((view) => view.nodes)
      .find((node) => node.parentId && node.elementRef);
    expect(child).toBeTruthy();
    const next = removeElements(model, [child!.elementRef!]);
    const errors = validate(serializeAoef(next));
    expect(errors).toEqual([]);
    // The child node is gone from the model.
    expect(next.views.some((view) => view.nodes.some((node) => node.id === child!.id))).toBe(false);
  });
});

describe('view integrity: grouping, ungrouping, reconnecting, merging', () => {
  it('group delete promotes children instead of orphaning their parentId', () => {
    const { model, groupElementId } = modelWithNestedContainer();
    const afterDelete = removeElements(model, [groupElementId]);
    const view = afterDelete.views[0];
    // No node points at a parent that no longer exists, and children keep their positions.
    for (const node of view.nodes) {
      if (node.parentId) expect(view.nodes.some((candidate) => candidate.id === node.parentId)).toBe(true);
    }
    expect(validateModel(afterDelete).some((issue) => issue.rule === 'view.dangling-parent')).toBe(false);
  });

  it('programmatic groups round-trip through AOEF with nesting intact', () => {
    const { model } = modelWithNestedContainer();
    const errors = validate(serializeAoef(model));
    expect(errors).toEqual([]);
    const reparsed = parseAoef(serializeAoef(model));
    const children = reparsed.views[0].nodes.filter((node) => node.parentId);
    expect(children.length).toBe(2);
  });

  it('ungroup prunes edges into the removed group and out of removed relationships', () => {
    const { model, groupNodeId, groupingElementId } = (() => {
      const inner = modelWithNestedContainer();
      return { ...inner, groupingElementId: inner.groupElementId };
    })();
    // Add a relationship involving the GROUP element so ungroup must prune its edge.
    const groupElement = getElementById(model, groupingElementId!)!;
    const second = model.elements.find((e) => e.id === 'e-portal')!;
    const relationshipId = `rel-${crypto.randomUUID()}`;
    const edgeId = `edge-${crypto.randomUUID()}`;
    const withGroupRel: Model = {
      ...model,
      relationships: [
        ...model.relationships,
        {
          id: relationshipId,
          type: 'Association',
          source: groupElement.id,
          target: second.id,
          name: [],
          documentation: [],
          properties: [],
        },
      ],
      views: model.views.map((view, index) =>
        index === 0
          ? {
              ...view,
              edges: [
                ...view.edges,
                {
                  id: edgeId,
                  type: 'Relationship',
                  relationshipRef: relationshipId,
                  source: groupNodeId,
                  target: view.nodes.find((node) => node.elementRef === 'e-portal')!.id,
                  bendpoints: [],
                },
              ],
            }
          : view,
      ),
    };
    const ungrouped = ungroupNodes(withGroupRel, 'view-overview', ['n1', 'n2']);
    expect(ungrouped.relationships.some((relationship) => relationship.id === relationshipId)).toBe(false);
    expect(ungrouped.views[0].edges.some((edge) => edge.id === edgeId)).toBe(false);
    expect(ungrouped.views.some((view) => view.edges.some((edge) => edge.relationshipRef === relationshipId))).toBe(
      false,
    );
    expect(validateModel(ungrouped).some((issue) => issue.severity === 'error')).toBe(false);
    if (xmllintAvailable) {
      expect(validate(serializeAoef(ungrouped))).toEqual([]);
    }
  });

  it('reconnect drops edges that can no longer depict the relationship faithfully', () => {
    const model = createSampleModel();
    // view-overview shows n1..n8; e-insurance is at n3 (present), e-billing is NOT in this view.
    const reconnected = reconnectRelationship(model, 'r-assign-1', 'e-insurance', 'e-billing');
    const relationship = reconnected.relationships.find((r) => r.id === 'r-assign-1')!;
    expect(relationship.source).toBe('e-insurance');
    expect(relationship.target).toBe('e-billing');
    // The old edge (n1→n2 depicting the OLD endpoints) must be gone — not silently lying.
    expect(reconnected.views[0].edges.some((edge) => edge.id === 'ed1')).toBe(false);
    expect(validateModel(reconnected).some((issue) => issue.rule === 'view.edge-mismatched-source')).toBe(false);
  });

  it('merge drops edges whose relationship was replaced with unreasonable endpoints', () => {
    const current = createSampleModel();
    const incoming = createSampleModel();
    // Incoming moves r-assign-1 to e-insurance→e-claim (visible in the view as n3→n2).
    incoming.relationships = incoming.relationships.map((r) =>
      r.id === 'r-assign-1' ? { ...r, source: 'e-insurance', target: 'e-claim' } : r,
    );
    const merged = mergeModels(current, incoming);
    const relationship = merged.relationships.find((r) => r.id === 'r-assign-1')!;
    expect([relationship.source, relationship.target]).toEqual(['e-insurance', 'e-claim']);
    const edge = merged.views[0].edges.find((edge) => edge.relationshipRef === 'r-assign-1');
    expect(edge).toBeTruthy();
    expect(edge!.source).toBe('n3'); // remapped faithfully, endpoints exist in view
    expect(validateModel(merged).some((issue) => issue.severity === 'error')).toBe(false);
  });

  it('merge unions domains and propertyDefinitions so merged elements stay resolvable', () => {
    const current = createSampleModel();
    current.propertyDefinitions = [];
    const incoming = createSampleModel();
    incoming.domains = [
      { id: 'domain-external', name: 'External' },
      ...(incoming.domains ?? []).map((domain) => ({ ...domain, id: `${domain.id}-b` })),
    ];
    incoming.propertyDefinitions = [{ id: 'pd-1', name: 'SLA', type: 'string' }];
    incoming.elements = incoming.elements.map((element) => ({ ...element, domain: 'domain-external' }));
    const merged = mergeModels(current, incoming);
    expect(merged.domains?.some((domain) => domain.id === 'domain-external')).toBe(true);
    expect(merged.propertyDefinitions.some((definition) => definition.id === 'pd-1')).toBe(true);
  });
});

describe('conflict entries', () => {
  it('classifies changed, added, and removed entities across both models', () => {
    const yours = createSampleModel();
    const theirs = createSampleModel();
    theirs.elements = theirs.elements.map((e) =>
      e.id === 'e-portal' ? { ...e, name: [{ lang: 'en', value: 'Portal v2' }] } : e,
    );
    const extra = {
      id: 'theirs-only-el',
      type: 'Node',
      name: [{ lang: 'en', value: 'Theirs node' }],
      documentation: [],
      properties: [],
    };
    theirs.elements.push(extra);
    const entries = conflictEntries(yours, theirs);
    const changed = entries.find((entry) => entry.id === 'e-portal');
    expect(changed?.status).toBe('changed');
    expect(changed?.theirs).toContain('Portal v2');
    const added = entries.find((entry) => entry.id === 'theirs-only-el');
    expect(added?.status).toBe('theirs-only');
    // Unchanged entities are not listed.
    expect(entries.some((entry) => entry.id === 'e-customer' && entry.status === 'changed')).toBe(false);
  });
});
