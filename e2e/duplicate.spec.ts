import { expect, test } from '@playwright/test';
import { addElement, clearSelection, connectNodes, createWorkspace, nodeByLabel } from './helpers';

/**
 * Drawing depth (roadmap Phase 7A): copy/paste/duplicate must copy the selected
 * subgraph — elements plus the relationships between them — into the model.
 */
test('duplicate copies the selected subgraph; paste re-inserts the clipboard', async ({ page }) => {
  await createWorkspace(page, 'E2E duplicate workspace');

  await addElement(page, 'Business Actor');
  await addElement(page, 'Business Process');
  const actor = nodeByLabel(page, 'Business Actor 1');
  const process = nodeByLabel(page, 'Business Process 2');
  await expect(actor).toBeVisible();
  await expect(process).toBeVisible();

  // Connect them so the selection is a real subgraph.
  await connectNodes(page, actor, process);
  await page.locator('.magic-choices button', { hasText: 'Assignment' }).click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);

  // Select both nodes and duplicate with Ctrl/Cmd+D.
  await actor.click();
  await process.click({ modifiers: ['Shift'] });
  await expect(page.locator('.selection-bar')).toContainText('2 selected');
  await page.keyboard.press('ControlOrMeta+d');

  await expect(page.locator('.archi-node')).toHaveCount(4);
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  await expect(nodeByLabel(page, 'Business Actor 1 (copy)')).toBeVisible();
  await expect(nodeByLabel(page, 'Business Process 2 (copy)')).toBeVisible();

  // Copy one node, then paste: one more element appears.
  await clearSelection(page);
  await nodeByLabel(page, 'Business Actor 1').click();
  await page.keyboard.press('ControlOrMeta+c');
  await page.keyboard.press('ControlOrMeta+v');
  await expect(page.locator('.archi-node')).toHaveCount(5);
  await expect(page.locator('.archi-node', { has: page.getByText('Business Actor 1 (copy)', { exact: true }) })).toHaveCount(2);

  // Autosave persists; after reload the duplicates are still there.
  await expect(page.locator('.save-badge')).not.toHaveClass(/dirty/, { timeout: 15_000 });
  await page.reload();
  await expect(page.locator('.archi-node')).toHaveCount(5);
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
});
