import { expect, test } from '@playwright/test';
import { addElement, clearSelection, createWorkspace, nodeByLabel } from './helpers';

/**
 * Drawing depth (roadmap Phase 7A): on-canvas rename and the context menu.
 */
test('double-click renames a node; context menu duplicates and deletes', async ({ page }) => {
  await createWorkspace(page, 'E2E editing workspace');
  await addElement(page, 'Business Actor');
  const actor = nodeByLabel(page, 'Business Actor 1');
  await expect(actor).toBeVisible();

  // Double-click opens the inline rename input; Enter commits to the model.
  await actor.dblclick();
  const renameInput = page.locator('.node-rename-input');
  await expect(renameInput).toBeVisible();
  await renameInput.fill('VIP Customer');
  await renameInput.press('Enter');
  await expect(nodeByLabel(page, 'VIP Customer')).toBeVisible();
  await expect(nodeByLabel(page, 'Business Actor 1')).toHaveCount(0);

  // Right-click the node → Duplicate.
  await nodeByLabel(page, 'VIP Customer').click({ button: 'right' });
  await expect(page.locator('.context-menu')).toBeVisible();
  await page.locator('.context-menu button', { hasText: 'Duplicate' }).click();
  await expect(page.locator('.archi-node')).toHaveCount(2);
  await expect(nodeByLabel(page, 'VIP Customer (copy)')).toBeVisible();

  // Right-click the copy → Delete.
  await nodeByLabel(page, 'VIP Customer (copy)').click({ button: 'right' });
  await page.locator('.context-menu button', { hasText: 'Delete' }).click();
  await expect(page.locator('.archi-node')).toHaveCount(1);

  // Right-click empty canvas → Paste re-inserts the clipboard (the copy was
  // deleted, so copy the remaining node first).
  await clearSelection(page);
  await nodeByLabel(page, 'VIP Customer').click();
  await page.keyboard.press('ControlOrMeta+c');
  await page.locator('.react-flow__pane').click({ button: 'right', position: { x: 40, y: 300 } });
  await expect(page.locator('.context-menu')).toBeVisible();
  await page.locator('.context-menu button', { hasText: 'Paste' }).click();
  await expect(page.locator('.archi-node')).toHaveCount(2);

  // Persisted via autosave across reload.
  await expect(page.locator('.save-badge')).not.toHaveClass(/dirty/, { timeout: 15_000 });
  await page.reload();
  await expect(page.locator('.archi-node')).toHaveCount(2);
  await expect(nodeByLabel(page, 'VIP Customer (copy)')).toBeVisible();
});
