import { validateModel } from '@openarch/core';
import { describe, expect, it } from 'vitest';
import { importDrawIo } from './drawio';

const DRAWIO_FIXTURE = `<mxfile host="test">
  <diagram id="page1" name="Page-1">
    <mxGraphModel dx="800" dy="600" grid="1">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <mxCell id="a1" value="Customer" style="shape=umlActor;verticalLabelPosition=bottom;" vertex="1" parent="1">
          <mxGeometry x="80" y="120" width="40" height="80" as="geometry" />
        </mxCell>
        <mxCell id="a2" value="API Gateway" style="rounded=1;" vertex="1" parent="1">
          <mxGeometry x="320" y="120" width="160" height="80" as="geometry" />
        </mxCell>
        <mxCell id="e1" value="uses" style="endArrow=block;" edge="1" parent="1" source="a1" target="a2">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="e2" value="dangling" edge="1" parent="1" source="a1" target="missing">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;

describe('draw.io import', () => {
  it('parses vertices, edges, positions; skips dangling edges with warnings', () => {
    const { model, warnings } = importDrawIo(DRAWIO_FIXTURE);
    expect(model.elements.length).toBe(2);
    expect(model.elements[0].name[0].value).toBe('Customer');
    // Actors become BusinessActor per the shape heuristic.
    expect(model.elements[0].type).toBe('BusinessActor');
    expect(model.elements[1].type).toBe('ApplicationComponent');
    expect(model.relationships.length).toBe(1);
    expect(model.views.length).toBe(1);
    const view = model.views[0];
    expect(view.nodes.length).toBe(2);
    expect(view.nodes[0].bounds).toMatchObject({ x: 80, y: 120 });
    expect(view.edges.length).toBe(1);
    // The dangling edge was skipped and reported.
    expect(warnings.some((warning) => warning.includes('endpoint'))).toBe(true);
    // Model is structurally valid.
    expect(validateModel(model).filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('scales very wide diagrams down to a usable view', () => {
    const wide = `<mxfile><diagram><mxGraphModel><root>
      <mxCell id="0"/><mxCell id="1" parent="0"/>
      ${Array.from({ length: 40 }, (_, i) => `<mxCell id="v${i}" value="N${i}" vertex="1" parent="1"><mxGeometry x="${i * 500}" y="100" width="160" height="80" as="geometry"/></mxCell>`).join('')}
    </root></mxGraphModel></diagram></mxfile>`;
    const { model } = importDrawIo(wide);
    const maxX = Math.max(...model.views[0].nodes.map((node) => node.bounds.x));
    expect(maxX).toBeLessThanOrEqual(6100);
  });

  it('rejects non-draw.io XML with a clear error', () => {
    expect(() => importDrawIo('<html><body>nope</body></html>')).toThrow(/Not a draw\.io diagram/);
  });
});
