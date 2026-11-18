import { expect, test } from '@playwright/test';

/**
 * Performance at scale (roadmap Phase 6): the canvas must render a
 * 2,000-element model in a reasonable time. Generous bound — this catches
 * pathological rendering, not normal variance.
 */
test('renders a 2,000-element imported model', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('openarch-onboarded', '1'));
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Import model/ })).toBeVisible();

  const elements = Array.from({ length: 2000 }, (_, i) => ({
    id: `e-${i}`,
    type: 'ApplicationComponent',
    name: [{ lang: 'en', value: `App ${i}` }],
    documentation: [],
    properties: [],
  }));
  const model = {
    id: 'model-big-e2e',
    name: [{ lang: 'en', value: 'Big E2E model' }],
    documentation: [],
    properties: [],
    propertyDefinitions: [],
    elements,
    relationships: [],
    views: [
      {
        id: 'view-big',
        type: 'Diagram',
        name: [{ lang: 'en', value: 'Big' }],
        nodes: elements.map((element, i) => ({
          id: `n-${i}`,
          type: 'Element',
          elementRef: element.id,
          label: [],
          bounds: { x: (i % 40) * 200, y: Math.floor(i / 40) * 100, w: 170, h: 64 },
        })),
        edges: [],
      },
    ],
  };

  // Import through the real file input, then measure render of all nodes.
  await page.locator('.home-topbar-actions input[type=file]').setInputFiles({
    name: 'big.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(model)),
  });
  await expect(page.getByRole('button', { name: /Add element/ })).toBeVisible();
  const start = Date.now();
  await expect(page.locator('.archi-node')).toHaveCount(2000, { timeout: 30_000 });
  const renderMs = Date.now() - start;
  console.log(`2,000 nodes rendered in ${renderMs} ms`);
  expect(renderMs).toBeLessThan(30_000);
});
