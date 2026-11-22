import { createSampleModel } from '@openarch/core';
import { describe, expect, it } from 'vitest';
import { applyIncomingOp, intentOps } from './opsClient';

const model = createSampleModel();

describe('opsClient intent helpers', () => {
  it('derives server-shaped ops for common editor intents', () => {
    const created = intentOps.elementCreate({ id: 'el-1', type: 'BusinessActor', name: 'Bob' });
    expect(created.kind).toBe('element.create');
    expect(created.after).toMatchObject({ type: 'BusinessActor', name: 'Bob' });

    const moved = intentOps.viewNodeMove('view-overview', 'n1', { x: 1, y: 2, w: 170, h: 64 });
    expect(moved.ref).toBe('view-overview');
    expect(moved.after).toMatchObject({ nodeId: 'n1', bounds: { x: 1, y: 2, w: 170, h: 64 } });
  });

  it('projects incoming ops locally so the canvas updates before the server answers', () => {
    const incoming = intentOps.elementRename('e-customer', 'Kunde');
    const applied = applyIncomingOp(model, incoming);
    expect(applied.error).toBeUndefined();
    expect(applied.model.elements.find((element) => element.id === 'e-customer')?.name[0].value).toBe('Kunde');
    // Input model untouched (pure).
    expect(model.elements.find((element) => element.id === 'e-customer')?.name[0].value).not.toBe('Kunde');
  });

  it('incoming invalid ops report an error instead of silently dropping', () => {
    const dangling = intentOps.relationshipCreate('rel-x', 'Serving', 'ghost', 'ghost-2');
    const applied = applyIncomingOp(model, dangling);
    expect(applied.error).toBeTruthy();
    expect(applied.model).toBe(model); // unchanged
  });
});
