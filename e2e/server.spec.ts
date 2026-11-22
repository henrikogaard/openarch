import { expect, test } from '@playwright/test';

/**
 * Server-mode E2E: the editor surface must work against the optional server,
 * not just local storage — create, edit, autosave, reload (deep link
 * re-open), then navigate home and re-open from the list.
 */
test('server mode: create, edit, reload, re-open stays durable', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('openarch-onboarded', '1'));
  await page.goto('/?mode=server');

  // Create a workspace through the UI.
  const newButton = page.getByRole('button', { name: /\+ New workspace/ }).first();
  await expect(newButton).toBeVisible();
  await newButton.click();
  const dialog = page.getByRole('dialog', { name: 'New workspace' });
  await dialog.getByPlaceholder('Claims platform 2027').fill('Server E2E workspace');
  await dialog.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('button', { name: /Add element/ })).toBeVisible();

  // Server storage mode is active.
  await expect(page.locator('.mode-badge', { hasText: 'server' })).toBeVisible();

  // Add an element through the palette.
  await page.getByRole('button', { name: /Add element/ }).click();
  await page.getByRole('button', { name: 'Business Actor', exact: true }).click();
  await expect(page.locator('.archi-node', { hasText: /Business Actor/ })).toBeVisible();

  // Autosave lands on the server, badge clears.
  await expect(page.locator('.save-badge')).not.toHaveClass(/dirty/, { timeout: 20_000 });

  // Reload: the deep link (workspace + mode preserved) reopens the editor
  // directly with the DURABLE server copy — element present, server mode kept.
  await page.reload();
  await expect(page.locator('.mode-badge', { hasText: 'server' })).toBeVisible();
  await expect(page.locator('.archi-node', { hasText: /Business Actor/ })).toBeVisible();

  // Navigate home and re-open from the list: the workspace survived round trips.
  await page.getByRole('button', { name: /← All workspaces/ }).click();
  const card = page.locator('.workspace-card', { hasText: 'Server E2E workspace' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('1 element');
  await card.click();
  await expect(page.getByRole('button', { name: /Add element/ })).toBeVisible();
  await expect(page.locator('.archi-node', { hasText: /Business Actor/ })).toBeVisible();
});
