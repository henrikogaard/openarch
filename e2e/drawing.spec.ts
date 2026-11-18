import { expect, test } from '@playwright/test';
import { addElement, connectNodes, createWorkspace, nodeByLabel } from './helpers';

/**
 * Drawing depth (roadmap Phase 7A-d): palette drag-and-drop, grouping,
 * z-order, bendpoints, presentation mode.
 */
test('palette drag-and-drop, group/ungroup, z-order, bendpoint, presentation', async ({ page }) => {
  await createWorkspace(page, 'E2E drawing workspace');

  // Drag a palette item onto the canvas (HTML5 drag-and-drop events).
  await page.getByRole('button', { name: /Add element/ }).click();
  await page.evaluate(() => {
    const source = [...document.querySelectorAll('.palette-items button')].find(
      (button) => button.textContent?.trim() === 'Business Actor',
    ) as HTMLElement;
    const pane = document.querySelector('.react-flow__pane') as HTMLElement;
    const rect = pane.getBoundingClientRect();
    const x = rect.x + 300;
    const y = rect.y + 200;
    const dataTransfer = new DataTransfer();
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
    pane.dispatchEvent(
      new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer, clientX: x, clientY: y }),
    );
    pane.dispatchEvent(
      new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer, clientX: x, clientY: y }),
    );
  });
  const actor = nodeByLabel(page, 'Business Actor 1');
  await expect(actor).toBeVisible();
  // Close the palette popover before using the click-to-add flow again.
  await page.getByRole('button', { name: /Add element/ }).click();

  await addElement(page, 'Business Process');
  const process = nodeByLabel(page, 'Business Process 2');
  await expect(process).toBeVisible();

  // Connect, then double-click the edge to add a bendpoint.
  await connectNodes(page, actor, process);
  await page.locator('.magic-choices button', { hasText: 'Assignment' }).click();
  const edge = page.locator('.react-flow__edge').first();
  await expect(edge).toHaveCount(1);
  const edgeBox = await edge.boundingBox();
  await page.mouse.dblclick(edgeBox!.x + edgeBox!.width / 2, edgeBox!.y + edgeBox!.height / 2);
  await expect(page.locator('.edge-bendpoint')).toHaveCount(1);

  // Group the two nodes, then ungroup.
  await actor.click();
  await process.click({ modifiers: ['Shift'] });
  await expect(page.locator('.selection-bar')).toContainText('2 selected');
  await page.locator('.selection-bar button', { hasText: 'Group' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(3); // 2 elements + group container
  await page.locator('.selection-bar button', { hasText: 'Ungroup' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);

  // Z-order: bring the actor to front.
  await actor.click();
  await page.locator('.selection-bar button', { hasText: 'Front' }).click();
  const zIndex = await actor.evaluate((el) => el.closest('.react-flow__node')?.style.zIndex ?? '');
  expect(Number(zIndex)).toBeGreaterThan(0);

  // Presentation mode hides the chrome and can be exited.
  await page.getByRole('button', { name: /Present/ }).click();
  await expect(page.locator('.sidebar')).toHaveCount(0);
  await expect(page.locator('.present-exit')).toBeVisible();
  await expect(actor).toBeVisible();
  await page.locator('.present-exit').click();
  await expect(page.locator('.sidebar')).toHaveCount(1);

  // Everything persisted via autosave across reload.
  await expect(page.locator('.save-badge')).not.toHaveClass(/dirty/, { timeout: 15_000 });
  await page.reload();
  await expect(page.locator('.archi-node')).toHaveCount(2);
  await expect(page.locator('.edge-bendpoint')).toHaveCount(1);
});
