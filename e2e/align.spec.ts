import { expect, test } from '@playwright/test';
import { addElement, createWorkspace, dragNode, nodeBoxes, nodeByLabel } from './helpers';

/**
 * Drawing depth (roadmap Phase 7A): align and distribute operate on the model,
 * so the result survives reload (via autosave).
 */
test('align and distribute selected nodes', async ({ page }) => {
  await createWorkspace(page, 'E2E align workspace');

  for (let i = 0; i < 3; i += 1) await addElement(page, 'Business Actor');
  const labels = ['Business Actor 1', 'Business Actor 2', 'Business Actor 3'];
  const nodes = labels.map((label) => nodeByLabel(page, label));
  for (const node of nodes) await expect(node).toBeVisible();

  const ySpread = async () => {
    const boxes = await nodeBoxes(page, labels);
    return Math.max(...boxes.map((b) => b.y)) - Math.min(...boxes.map((b) => b.y));
  };
  const yGapEvenness = async () => {
    const boxes = (await nodeBoxes(page, labels)).sort((a, b) => a.y - b.y);
    return Math.abs(boxes[1].y - boxes[0].y - (boxes[2].y - boxes[1].y));
  };

  // Move the middle node down so the column is uneven.
  await dragNode(page, nodes[1], 0, 150);
  await expect.poll(ySpread).toBeGreaterThan(50);

  // Select all three and distribute vertically: y gaps become equal.
  await nodes[0].click();
  await nodes[1].click({ modifiers: ['Shift'] });
  await nodes[2].click({ modifiers: ['Shift'] });
  await expect(page.locator('.selection-bar')).toContainText('3 selected');
  await page.locator('.selection-bar select[aria-label="Distribute selection"]').selectOption('y');
  await expect.poll(yGapEvenness).toBeLessThan(5);

  // Align top: all y coordinates become equal.
  await page.locator('.selection-bar select[aria-label="Align selection"]').selectOption('top');
  await expect.poll(ySpread).toBeLessThan(3);

  // Persisted via autosave across reload: still aligned and evenly spaced in x.
  await expect(page.locator('.save-badge')).not.toHaveClass(/dirty/, { timeout: 15_000 });
  await page.reload();
  for (const node of nodes) await expect(node).toBeVisible();
  await expect.poll(ySpread).toBeLessThan(3);
  const xGapEvenness = async () => {
    const boxes = (await nodeBoxes(page, labels)).sort((a, b) => a.x - b.x);
    return Math.abs(boxes[1].x - boxes[0].x - (boxes[2].x - boxes[1].x));
  };
  await expect.poll(xGapEvenness).toBeLessThan(5);
});
