import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { addElement, clearSelection, connectNodes, createWorkspace, nodeByLabel } from './helpers';

/**
 * Sprint definition of done (docs/status-2026-11-17.md §5): a new user can
 * create a workspace, draw and connect elements, bulk-assign an attribute,
 * delete an element, reload without losing work, and export a valid AOEF file.
 */
test('create → add → connect → bulk-assign → delete → reload → export AOEF', async ({ page }) => {
  await createWorkspace(page, 'E2E smoke workspace');

  // Add two elements from the palette.
  await addElement(page, 'Business Actor');
  await addElement(page, 'Business Process');
  const actor = nodeByLabel(page, 'Business Actor 1');
  const process = nodeByLabel(page, 'Business Process 2');
  await expect(actor).toBeVisible();
  await expect(process).toBeVisible();

  // Connect them with the magic connector, then pick the relationship type.
  await connectNodes(page, actor, process);
  await expect(page.locator('.magic-menu')).toBeVisible();
  await page.locator('.magic-choices button', { hasText: 'Assignment' }).click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);

  // Multi-select both nodes and bulk-assign an environment.
  await actor.click();
  await process.click({ modifiers: ['Shift'] });
  const selectionBar = page.locator('.selection-bar');
  await expect(selectionBar).toContainText('2 selected');
  await selectionBar.locator('select[aria-label^="Set environment"]').selectOption('prod');
  await expect(page.locator('.status')).toContainText('Updated 2 elements');

  // Delete the process node; the model (not just the canvas) must lose it,
  // together with its relationship edge.
  await clearSelection(page);
  await process.click();
  await page.keyboard.press('Delete');
  await expect(process).toHaveCount(0);
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  await expect(page.locator('.status')).toContainText('Deleted 1 element');

  // Autosave persists the change; wait for the saved badge to clear "dirty".
  await expect(page.locator('.save-badge')).not.toHaveClass(/dirty/, { timeout: 15_000 });

  // Reload: the deep link reopens the workspace and the deletion persisted.
  await page.reload();
  await expect(nodeByLabel(page, 'Business Actor 1')).toBeVisible();
  await expect(nodeByLabel(page, 'Business Process 2')).toHaveCount(0);
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);

  // Export AOEF: the file must be an ArchiMate model containing only the
  // surviving element.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export AOEF (.xml)' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.xml$/);
  const xml = await readFile(await download.path(), 'utf8');
  expect(xml).toContain('http://www.opengroup.org/xsd/archimate/3.0/');
  expect(xml).toContain('Business Actor');
  expect(xml).not.toContain('Business Process');
});
