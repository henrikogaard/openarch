import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

/**
 * Sprint definition of done (docs/status-2026-11-17.md §5): a new user can
 * create a workspace, draw and connect elements, bulk-assign an attribute,
 * delete an element, reload without losing work, and export a valid AOEF file.
 */
test('create → add → connect → bulk-assign → delete → reload → export AOEF', async ({ page }) => {
  await page.goto('/');

  // First run seeds a sample workspace asynchronously; wait for the home UI.
  const newButton = page.getByRole('button', { name: /\+ New workspace/ }).first();
  await expect(newButton).toBeVisible();

  // Create a blank workspace.
  await newButton.click();
  const dialog = page.getByRole('dialog', { name: 'New workspace' });
  await dialog.getByPlaceholder('Claims platform 2027').fill('E2E smoke workspace');
  await dialog.getByRole('button', { name: 'Create workspace' }).click();

  // The editor opens on the new workspace.
  await expect(page.getByRole('button', { name: /Add element/ })).toBeVisible();

  // Add two elements from the palette.
  const palette = page.getByRole('button', { name: /Add element/ });
  await palette.click();
  await page.getByRole('button', { name: 'Business Actor', exact: true }).click();
  await palette.click();
  await page.getByRole('button', { name: 'Business Process', exact: true }).click();

  const actor = page.locator('.archi-node', { hasText: /Business Actor/ });
  const process = page.locator('.archi-node', { hasText: /Business Process/ });
  await expect(actor).toBeVisible();
  await expect(process).toBeVisible();

  // Connect them with the magic connector: drag from the actor's source handle
  // to the process node, then pick the relationship type.
  const sourceHandle = actor.locator('.react-flow__handle.source').first();
  const targetHandle = process.locator('.react-flow__handle.target').first();
  const from = await sourceHandle.boundingBox();
  const to = await targetHandle.boundingBox();
  expect(from).toBeTruthy();
  expect(to).toBeTruthy();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 12 });
  await page.mouse.up();

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
  await process.click();
  await page.keyboard.press('Delete');
  await expect(process).toHaveCount(0);
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  await expect(page.locator('.status')).toContainText('Deleted 1 element');

  // Autosave persists the change; wait for the saved badge to clear "dirty".
  await expect(page.locator('.save-badge')).not.toHaveClass(/dirty/, { timeout: 15_000 });

  // Reload: the deep link reopens the workspace and the deletion persisted.
  await page.reload();
  await expect(page.locator('.archi-node', { hasText: /Business Actor/ })).toBeVisible();
  await expect(page.locator('.archi-node', { hasText: /Business Process/ })).toHaveCount(0);
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
