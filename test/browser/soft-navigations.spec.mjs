import { expect, test } from '@playwright/test';

test('Web Vitals are reported per soft navigation', async ({ browserName, page }) => {
  test.skip(browserName !== 'chromium', 'Soft navigation detection is Chromium-only (151+)');

  await page.goto('/');
  await expect(page.locator('#status-text')).toHaveText('running');
  await page.locator('#soft-nav-button').click();

  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            window.monitorDemo
              .snapshot()
              .webVitals.entries.filter((entry) => entry.navigationType === 'soft-navigation')
              .length,
        ),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0);

  const { entries, lcp } = await page.evaluate(() => window.monitorDemo.snapshot().webVitals);
  const hard = entries.filter((entry) => entry.navigationType !== 'soft-navigation');
  const soft = entries.filter((entry) => entry.navigationType === 'soft-navigation');
  const routeOf = (entry) => {
    const url = new URL(entry.navigationURL);

    return url.pathname + url.search;
  };

  expect(hard.length).toBeGreaterThan(0);
  expect(hard.every((entry) => routeOf(entry) === '/')).toBe(true);
  expect(soft.every((entry) => routeOf(entry) === '/?view=orders')).toBe(true);
  expect(new Set(soft.map((entry) => entry.navigationId)).size).toBe(1);
  expect(soft[0].navigationId).toBeGreaterThan(
    Math.max(...hard.map((entry) => entry.navigationId)),
  );
  // The latest LCP belongs to the soft navigation, even if the first page reports later.
  expect(lcp).toMatchObject({
    navigationType: 'soft-navigation',
    navigationId: soft[0].navigationId,
  });

  // The demo counts the page views and shows which one the LCP belongs to.
  await expect(page.locator('#page-views')).toHaveText('2');
  await expect(page.locator('#page-view-detail')).toHaveText('1 soft navigation');
  await expect(page.locator('#lcp-detail')).toHaveText('/?view=orders · soft-navigation');
});
