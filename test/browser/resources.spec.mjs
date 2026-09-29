import { expect, test } from '@playwright/test';

test('Resource Timing records page assets but not fetch or XHR requests', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#status-text')).toHaveText('running');
  await page.locator('#fetch-button').click();
  await page.locator('#xhr-button').click();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const { resources } = window.monitorDemo.snapshot();

        return {
          stylesheets: resources.byType.stylesheet.count,
          scripts: resources.byType.script.count,
        };
      }),
    )
    .toEqual({ stylesheets: expect.any(Number), scripts: expect.any(Number) });

  const resources = await page.evaluate(() => window.monitorDemo.snapshot().resources);
  const urls = resources.entries.map((entry) => new URL(entry.url).pathname);

  expect(urls).toContain('/demo/styles.css');
  expect(urls).toContain('/dist/index.js');
  expect(urls).not.toContain('/api/fetch');
  expect(urls).not.toContain('/api/xhr');
  expect(resources.byType.stylesheet.count).toBeGreaterThanOrEqual(1);
  expect(resources.byType.script.count).toBeGreaterThanOrEqual(1);
  expect(resources.totals.thirdPartyCount).toBe(0);
  expect(resources.slowest.length).toBeGreaterThan(0);
  expect(resources.entries.every((entry) => entry.duration >= 0)).toBe(true);
});
