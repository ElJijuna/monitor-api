import { expect, test } from '@playwright/test';

test('demo captures browser activity through the built package', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('monitor-api demo')).toBeVisible();
  await expect(page.locator('#status-text')).toHaveText('running');

  await page.locator('#event-button').click();
  await page.locator('#fetch-button').click();
  await page.locator('#xhr-button').click();
  await page.locator('#error-button').click();
  await page.locator('#flush-button').click();

  await expect(page.locator('#event-count')).toHaveText('1');
  await expect(page.locator('#error-count')).toHaveText('1');
  await expect(page.locator('#reporter-sent')).toHaveText('1');

  await expect
    .poll(() =>
      page.evaluate(() => {
        const snapshot = window.monitorDemo.snapshot();

        return {
          errors: snapshot.errors.totalErrors,
          events: snapshot.events.entries.length,
          network: snapshot.network.entries.map((entry) => ({
            initiator: entry.initiator,
            status: entry.status,
            url: entry.url,
          })),
          reports: window.monitorDemo.monitor.reporter.snapshot.value.sent,
        };
      }),
    )
    .toMatchObject({
      errors: 1,
      events: 1,
      network: expect.arrayContaining([
        expect.objectContaining({ initiator: 'fetch', status: 200, url: '/api/fetch' }),
        expect.objectContaining({ initiator: 'xhr', status: 201, url: '/api/xhr' }),
      ]),
      reports: 1,
    });

  const storedReports = await page.request.get('/api/reports').then((response) => response.json());

  expect(storedReports.reports).toHaveLength(1);
  expect(storedReports.reports[0]).toMatchObject({
    errors: { totalErrors: 1 },
    events: { count: 1 },
    network: { window5s: expect.any(Object) },
  });
});
