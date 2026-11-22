import { describe, expect, it } from 'vitest';
import { layoutView } from './layout';

describe('auto-layout', () => {
  const order = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const edges = [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'c' },
    { source: 'a', target: 'd' },
    { source: 'e', target: 'f' },
  ];

  it('grid mode packs in reading order deterministically', () => {
    const first = layoutView(order, [], { mode: 'grid', columns: 3 });
    const second = layoutView(order, [], { mode: 'grid', columns: 3 });
    expect([...first.entries()]).toEqual([...second.entries()]);
    expect(first.get('a')).toMatchObject({ x: 60, y: 80 });
    expect(first.get('d')).toMatchObject({ x: 60, y: 200 }); // row 2
  });

  it('layers mode places sources before sinks', () => {
    const laid = layoutView(order, edges, { mode: 'layers', columnGap: 240 });
    expect(laid.get('a')!.x).toBeLessThan(laid.get('b')!.x);
    expect(laid.get('b')!.x).toBeLessThan(laid.get('c')!.x);
    expect(laid.get('e')!.x).toBeLessThan(laid.get('f')!.x);
    // Disconnected node g is still laid out.
    expect(laid.has('g')).toBe(true);
  });

  it('handles pure cycles without hanging', () => {
    const cycleEdges = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'a' },
    ];
    const laid = layoutView(['a', 'b'], cycleEdges, { mode: 'layers' });
    expect(laid.size).toBe(2);
  });
});
