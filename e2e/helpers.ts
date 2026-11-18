import { expect, type Locator, type Page } from '@playwright/test';

/** Create a blank workspace from the home screen and land in the editor. */
export async function createWorkspace(page: Page, name: string): Promise<void> {
  await page.goto('/');
  const newButton = page.getByRole('button', { name: /\+ New workspace/ }).first();
  await expect(newButton).toBeVisible();
  await newButton.click();
  const dialog = page.getByRole('dialog', { name: 'New workspace' });
  await dialog.getByPlaceholder('Claims platform 2027').fill(name);
  await dialog.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('button', { name: /Add element/ })).toBeVisible();
}

/** Add an element type from the palette. */
export async function addElement(page: Page, typeLabel: string): Promise<void> {
  await page.getByRole('button', { name: /Add element/ }).click();
  await page.getByRole('button', { name: typeLabel, exact: true }).click();
}

/** Locator for the canvas node showing an element with the exact label. */
export function nodeByLabel(page: Page, label: string): Locator {
  return page.locator('.archi-node', { has: page.getByText(label, { exact: true }) });
}

export async function dragNode(page: Page, node: Locator, dx: number, dy: number): Promise<void> {
  const box = await node.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + dx, box!.y + box!.height / 2 + dy, { steps: 8 });
  await page.mouse.up();
}

export async function nodeBoxes(
  page: Page,
  labels: string[],
): Promise<Array<{ x: number; y: number }>> {
  const boxes = await Promise.all(labels.map((label) => nodeByLabel(page, label).boundingBox()));
  return boxes.map((box) => ({ x: box!.x, y: box!.y }));
}

/**
 * Click empty canvas (left-middle of the pane) to clear the selection.
 * React Flow keeps a multi-selection when a selected node is plain-clicked,
 * so tests that need a single selection must clear first.
 */
export async function clearSelection(page: Page): Promise<void> {
  const pane = await page.locator('.react-flow__pane').boundingBox();
  expect(pane).toBeTruthy();
  await page.mouse.click(pane!.x + 40, pane!.y + pane!.height / 2);
  await expect(page.locator('.selection-bar')).toHaveCount(0);
}

/** Drag a connection from one node's source handle to another's target handle. */
export async function connectNodes(page: Page, from: Locator, to: Locator): Promise<void> {
  const fromBox = await from.locator('.react-flow__handle.source').first().boundingBox();
  const toBox = await to.locator('.react-flow__handle.target').first().boundingBox();
  expect(fromBox).toBeTruthy();
  expect(toBox).toBeTruthy();
  await page.mouse.move(fromBox!.x + fromBox!.width / 2, fromBox!.y + fromBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(toBox!.x + toBox!.width / 2, toBox!.y + toBox!.height / 2, { steps: 12 });
  await page.mouse.up();
}
