import { expect, test } from '@playwright/test';

test('Long Animation Frames attribute a blocking click handler', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'The Long Animation Frames API is Chromium-only');

  await page.goto('/');
  await expect(page.locator('#status-text')).toHaveText('running');
  await page.locator('#block-button').click();

  await expect
    .poll(() =>
      page.evaluate(() => window.monitorDemo.snapshot().performance.longAnimationFrames.count),
    )
    .toBeGreaterThan(0);

  const info = await page.evaluate(
    () => window.monitorDemo.snapshot().performance.longAnimationFrames,
  );
  const blocked = info.entries.find((entry) =>
    entry.scripts.some((script) => script.invokerType === 'event-listener'),
  );

  expect(info.totalBlockingDuration).toBeGreaterThan(0);
  expect(info.maxBlockingDuration).toBeGreaterThanOrEqual(100);
  expect(blocked).toBeDefined();
  expect(blocked.duration).toBeGreaterThanOrEqual(200);
  expect(blocked.timestamp).toBeGreaterThan(Date.now() - 60_000);

  const [longest] = blocked.scripts;

  expect(longest.invokerType).toBe('event-listener');
  expect(longest.invoker).toContain('#block-button');
  expect(longest.duration).toBeGreaterThanOrEqual(190);

  // The demo shows the frame and names the handler in its activity log.
  await expect(page.locator('#loaf-count')).not.toHaveText('0');
  await expect(page.locator('#loaf-detail')).toContainText('Worst blocked input for');
  await expect(page.locator('#activity')).toContainText('#block-button');
});
