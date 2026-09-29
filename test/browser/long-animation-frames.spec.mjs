import { expect, test } from '@playwright/test';

test('Long Animation Frames attribute a blocking click handler', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'The Long Animation Frames API is Chromium-only');

  await page.goto('/');
  await expect(page.locator('#status-text')).toHaveText('running');
  await page.evaluate(() => {
    document.querySelector('#event-button').addEventListener('click', function blockMainThread() {
      const end = performance.now() + 150;

      while (performance.now() < end) {
        // Busy-wait so the frame that handles the click becomes a long animation frame.
      }
    });
  });
  await page.locator('#event-button').click();

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
  expect(blocked.duration).toBeGreaterThanOrEqual(150);
  expect(blocked.timestamp).toBeGreaterThan(Date.now() - 60_000);

  const [longest] = blocked.scripts;

  expect(longest.invokerType).toBe('event-listener');
  expect(longest.invoker).toContain('click');
  expect(longest.duration).toBeGreaterThanOrEqual(140);
});
