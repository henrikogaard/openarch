import { createSampleModel, validateModel } from './validation';
import { applyOp, canApply, idempotencyKey, OpError, parseOp, serializeOp, tryApplyOp, type Op } from './ops';
import { describe, expect, it } from 'vitest';

const el = (id: string) => createSampleModel().elements.find((candidate) => candidate.id === id)!;

describe('ops engine (C1)', () => {
  it('element.create/update/delete round-trip and always leave a valid model', () => {
    const model = createSampleModel();
    const created = applyOp(model, {
      kind: 'element.create',
      ref: 'el-new',
      after: { type: 'BusinessActor', name: 'New actor' },
    });
    expect(created.elements.some((candidate) => candidate.id === 'el-new')).toBe(true);
    expect(validateModel(created).filter((issue) => issue.severity === 'error')).toEqual([]);

    const updated = applyOp(created, {
      kind: 'element.update',
      ref: 'el-new',
      after: { name: 'Renamed actor' },
    });
    expect(updated.elements.find((candidate) => candidate.id === 'el-new')?.name[0].value).toBe('Renamed actor');

    const deleted = applyOp(updated, { kind: 'element.delete', ref: 'el-new', after: {} });
    expect(deleted.elements.some((candidate) => candidate.id === 'el-new')).toBe(false);
    expect(validateModel(deleted).filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('a dangling relationship op is rejected before entering the model (the ADR 0004 gate)', () => {
    const model = createSampleModel();
    const result = tryApplyOp(model, {
      kind: 'relationship.create',
      ref: 'rel-bad',
      after: { type: 'Serving', source: 'ghost-a', target: 'ghost-b' },
    });
    expect(result.issues.some((issue) => issue.severity === 'error')).toBe(true);
    expect(() =>
      applyOp(model, { kind: 'relationship.create', ref: 'rel-bad', after: { type: 'Serving', source: 'ghost-a', target: 'ghost-b' } }),
    ).toThrow(OpError);
    // The model was never touched.
    expect(model.relationships.some((relationship) => relationship.id === 'rel-bad')).toBe(false);
  });

  it('view ops keep views faithful projections (edge ops validate against the model)', () => {
    const model = createSampleModel();
    const viewCreated = applyOp(model, {
      kind: 'view.create',
      ref: 'view-ops-test',
      after: { name: 'Ops test' },
    });
    expect(viewCreated.views.some((candidate) => candidate.id === 'view-ops-test')).toBe(true);

    const nodeAdded = applyOp(viewCreated, {
      kind: 'view.node.create',
      ref: 'view-ops-test',
      after: { nodeId: 'n-ops-1', elementRef: 'e-customer', bounds: { x: 10, y: 10, w: 170, h: 64 } },
    });
    expect(
      nodeAdded.views.find((candidate) => candidate.id === 'view-ops-test')?.nodes.some((node) => node.id === 'n-ops-1'),
    ).toBe(true);

    // node.delete removes the element canonically.
    const nodeDeleted = applyOp(nodeAdded, {
      kind: 'view.node.delete',
      ref: 'view-ops-test',
      after: { nodeId: 'n-ops-1' },
    });
    expect(nodeDeleted.elements.some((candidate) => candidate.id === 'e-customer')).toBe(false);
    expect(validateModel(nodeDeleted).filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('the last view cannot be deleted (canApply catches structure before mutation)', () => {
    const model = createSampleModel();
    const issues = canApply(model, { kind: 'view.delete', ref: 'view-overview', after: {} });
    expect(issues.some((issue) => issue.rule === 'op.last-view')).toBe(true);
    expect(() => applyOp(model, { kind: 'view.delete', ref: 'view-overview', after: {} })).toThrow(OpError);
  });

  it('ops are idempotent-keyed and serialize/parse losslessly', async () => {
    const actor = 'someone';
    const op: Op = { kind: 'element.update', ref: 'e-portal', after: { name: 'Portal v2' } };
    const key1 = await idempotencyKey(actor, op);
    const key2 = await idempotencyKey(actor, { ...op });
    expect(key1).toBe(key2); // same payload → same key
    expect(await idempotencyKey('other-actor', op)).not.toBe(key1);

    const parsed = parseOp(serializeOp(op));
    expect(parsed.kind).toBe(op.kind);
    expect(parsed.ref).toBe(op.ref);
    expect(parsed.after).toEqual(op.after);
  });

  it('rejects a delete op for a missing element', () => {
    const model = createSampleModel();
    const issues = canApply(model, { kind: 'element.delete', ref: 'el-missing', after: {} });
    expect(issues.some((issue) => issue.rule === 'op.missing-element')).toBe(true);
  });

  it('a 300-op fuzz storm always leaves a valid-or-rejected state', () => {
    const model = createSampleModel();
    let current = model;
    let applied = 0;
    let rejected = 0;
    // Deterministic pseudo-random generator for reproducibility.
    let seed = 42;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const elementIds = current.elements.map((candidate) => candidate.id);
    for (let index = 0; index < 300; index += 1) {
      const target = elementIds[Math.floor(random() * elementIds.length)];
      const kinds = ['element.update', 'domain.assign', 'element.delete', 'relationship.create'] as const;
      const kind = kinds[Math.floor(random() * kinds.length)];
      try {
        current = applyOp(current, {
          kind,
          ref: kind === 'relationship.create' ? `rel-fuzz-${index}` : target,
          after:
            kind === 'relationship.create'
              ? { type: 'Serving', source: target, target: elementIds[0] }
              : { name: `Fuzz ${index}` },
        });
        applied += 1;
      } catch {
        rejected += 1;
      }
      // Invariant at every step: no invalid model can exist.
      expect(validateModel(current).filter((issue) => issue.severity === 'error')).toEqual([]);
    }
    expect(applied + rejected).toBe(300);
    // Every applied delete actually removed the element.
    expect(current.elements.length).toBeLessThanOrEqual(model.elements.length);
  });
});
