import { expect, test } from '@playwright/test';

test('Web Vitals are reported per soft navigation', async ({ browserName, page }) => {
  test.skip(browserName !== 'chromium', 'Soft navigation detection is Chromium-only (151+)');

  await page.goto('/');
  await expect(page.locator('#status-text')).toHaveText('running');
  await page.evaluate(async () => {
    const { createMonitor } = await import('/dist/index.js');
    const monitor = createMonitor({
      collectors: { webVitals: { softNavigations: true, reportAllChanges: true } },
    });

    monitor.start();
    window.softNavMonitor = monitor;

    // An SPA-style route change: a click that updates the URL and paints new content.
    const link = document.createElement('a');

    link.id = 'soft-nav-link';
    link.href = '/cart';
    link.textContent = 'Go to cart';
    link.addEventListener('click', (event) => {
      event.preventDefault();
      history.pushState({}, '', '/cart');

      const view = document.createElement('main');

      view.innerHTML = '<h1>Cart</h1><p>Three items, ready to check out.</p>';
      document.body.replaceChildren(view);
    });
    document.body.append(link);
  });

  await page.locator('#soft-nav-link').click();

  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            window.softNavMonitor.webVitals.snapshot.value.entries.filter(
              (entry) => entry.navigationType === 'soft-navigation',
            ).length,
        ),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0);

  const { entries, lcp } = await page.evaluate(
    () => window.softNavMonitor.webVitals.snapshot.value,
  );
  const hard = entries.filter((entry) => entry.navigationType !== 'soft-navigation');
  const soft = entries.filter((entry) => entry.navigationType === 'soft-navigation');
  const pathOf = (entry) => new URL(entry.navigationURL).pathname;

  expect(hard.length).toBeGreaterThan(0);
  expect(hard.every((entry) => pathOf(entry) === '/')).toBe(true);
  expect(soft.every((entry) => pathOf(entry) === '/cart')).toBe(true);
  expect(new Set(soft.map((entry) => entry.navigationId)).size).toBe(1);
  expect(soft[0].navigationId).toBeGreaterThan(
    Math.max(...hard.map((entry) => entry.navigationId)),
  );
  // The latest LCP belongs to the soft navigation, even if the first page reports later.
  expect(lcp).toMatchObject({
    navigationType: 'soft-navigation',
    navigationId: soft[0].navigationId,
  });
});
