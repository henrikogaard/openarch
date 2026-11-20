import { expect, test } from '@playwright/test';

/**
 * E2 (public-BYO): the app must never send model data to the hosting origin.
 * The bundle is served with VITE_API_URL pointing at a *foreign* host; the
 * client must not leak any POST/PUT to the public origin itself.
 */
test('local mode sends no data to any origin', async ({ page }) => {
  const violations: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method())) {
      violations.push(`${request.method()} ${url.origin}${url.pathname}`);
    }
  });
  await page.addInitScript(() => localStorage.setItem('openarch-onboarded', '1'));
  await page.goto('/');
  await expect(page.getByRole('button', { name: /\+ New workspace/ }).first()).toBeVisible();
  // Idle briefly to catch autosave stragglers.
  await page.waitForTimeout(2500);
  expect(violations).toEqual([]);
});
