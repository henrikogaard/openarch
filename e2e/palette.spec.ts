import { expect, test } from '@playwright/test';
import { addElement, createWorkspace, nodeByLabel } from './helpers';

/**
 * Phase 7: ⌘K command palette searches elements/views/workspaces/actions.
 */
test('command palette finds an element and runs an action', async ({ page }) => {
  await createWorkspace(page, 'E2E palette workspace');
  await addElement(page, 'Business Actor');
  await expect(nodeByLabel(page, 'Business Actor 1')).toBeVisible();

  // Open the palette, search for the element, run it → editor + inspector.
  await page.keyboard.press('ControlOrMeta+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await palette.locator('input').fill('Business Actor');
  await expect(palette.locator('.command-item', { hasText: 'Business Actor 1' })).toBeVisible();
  await palette.locator('.command-item', { hasText: 'Business Actor 1' }).click();
  await expect(palette).toHaveCount(0);
  await expect(page.locator('.inspector')).toContainText('Business Actor 1');

  // Run the Save action from the palette.
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('dialog', { name: 'Command palette' }).locator('input').fill('save');
  await page
    .getByRole('dialog', { name: 'Command palette' })
    .locator('.command-item', { hasText: 'Save workspace' })
    .click();
  await expect(page.locator('.status')).toContainText('Workspace saved');

  // Escape closes the palette without running anything.
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toHaveCount(0);
});

test('palette searches elements across all workspaces', async ({ page }) => {
  await createWorkspace(page, 'E2E search workspace A');
  await addElement(page, 'Business Actor');
  await expect(nodeByLabel(page, 'Business Actor 1')).toBeVisible();
  // Let autosave persist the new element before navigating away.
  await expect(page.locator('.save-badge')).not.toHaveClass(/dirty/, { timeout: 15_000 });

  // Second workspace; the palette should find the first workspace's element.
  await page.getByRole('button', { name: '← All workspaces' }).click();
  await createWorkspaceFromHome(page, 'E2E search workspace B');
  await page.keyboard.press('ControlOrMeta+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.locator('input').fill('Business Actor');
  const crossResult = palette.locator('.command-item', { hasText: 'Business Actor 1' });
  await expect(crossResult.first()).toBeVisible();
  await crossResult.first().click();
  // Running it opens workspace A with the element selected.
  await expect(page.locator('.inspector')).toContainText('Business Actor 1');
});

async function createWorkspaceFromHome(page: import('@playwright/test').Page, name: string): Promise<void> {
  const newButton = page.getByRole('button', { name: /\+ New workspace/ }).first();
  await expect(newButton).toBeVisible();
  await newButton.click();
  const dialog = page.getByRole('dialog', { name: 'New workspace' });
  await dialog.getByPlaceholder('Claims platform 2027').fill(name);
  await dialog.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('button', { name: /Add element/ })).toBeVisible();
}
