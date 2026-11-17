import { expect, test } from '@playwright/test';

/**
 * Drawing depth (roadmap Phase 7A): copy/paste/duplicate must copy the selected
 * subgraph — elements plus the relationships between them — into the model.
 */
test('duplicate copies the selected subgraph; paste re-inserts the clipboard', async ({ page }) => {
  await page.goto('/');
  const newButton = page.getByRole('button', { name: /\+ New workspace/ }).first();
  await expect(newButton).toBeVisible();
  await newButton.click();
  const dialog = page.getByRole('dialog', { name: 'New workspace' });
  await dialog.getByPlaceholder('Claims platform 2027').fill('E2E duplicate workspace');
  await dialog.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('button', { name: /Add element/ })).toBeVisible();

  const palette = page.getByRole('button', { name: /Add element/ });
  await palette.click();
  await page.getByRole('button', { name: 'Business Actor', exact: true }).click();
  await palette.click();
  await page.getByRole('button', { name: 'Business Process', exact: true }).click();

  const actor = page.locator('.archi-node', { has: page.getByText('Business Actor 1', { exact: true }) });
  const process = page.locator('.archi-node', { has: page.getByText('Business Process 2', { exact: true }) });
  await expect(actor).toBeVisible();
  await expect(process).toBeVisible();

  // Connect them so the selection is a real subgraph.
  const from = await actor.locator('.react-flow__handle.source').first().boundingBox();
  const to = await process.locator('.react-flow__handle.target').first().boundingBox();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.locator('.magic-choices button', { hasText: 'Assignment' }).click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);

  // Select both nodes and duplicate with Ctrl/Cmd+D.
  await actor.click();
  await process.click({ modifiers: ['Shift'] });
  await expect(page.locator('.selection-bar')).toContainText('2 selected');
  await page.keyboard.press('ControlOrMeta+d');

  await expect(page.locator('.archi-node')).toHaveCount(4);
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  await expect(page.locator('.archi-node', { hasText: 'Business Actor 1 (copy)' })).toBeVisible();
  await expect(page.locator('.archi-node', { hasText: 'Business Process 2 (copy)' })).toBeVisible();

  // Copy one node, then paste: one more element appears.
  await page.locator('.archi-node', { has: page.getByText('Business Actor 1', { exact: true }) }).click();
  await page.keyboard.press('ControlOrMeta+c');
  await page.keyboard.press('ControlOrMeta+v');
  await expect(page.locator('.archi-node')).toHaveCount(5);
  await expect(page.locator('.archi-node', { hasText: 'Business Actor 1 (copy)' })).toHaveCount(2);

  // Autosave persists; after reload the duplicates are still there.
  await expect(page.locator('.save-badge')).not.toHaveClass(/dirty/, { timeout: 15_000 });
  await page.reload();
  await expect(page.locator('.archi-node')).toHaveCount(5);
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
});
