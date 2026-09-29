import { expect, test } from '@playwright/test';

test('Web Vitals attribution names the LCP element and the INP interaction', async ({
  browserName,
  page,
}) => {
  test.skip(browserName !== 'chromium', 'LCP and INP attribution are Chromium-only');

  await page.goto('/');
  await expect(page.locator('#status-text')).toHaveText('running');
  await page.locator('#event-button').click();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const { lcp, inp } = window.monitorDemo.snapshot().webVitals;

        return { lcp: lcp?.attribution ?? null, inp: inp?.attribution ?? null };
      }),
    )
    .toMatchObject({
      lcp: {
        target: expect.any(String),
        timeToFirstByte: expect.any(Number),
        elementRenderDelay: expect.any(Number),
      },
      inp: {
        interactionTarget: '#event-button',
        interactionType: 'pointer',
        processingDuration: expect.any(Number),
      },
    });

  const serializable = await page.evaluate(() =>
    JSON.stringify(window.monitorDemo.snapshot().webVitals),
  );

  expect(serializable).toContain('"attribution"');
});
