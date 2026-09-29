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

  // The server keeps reports from every page, and parallel tests post theirs too.
  expect(storedReports.reports).toContainEqual(
    expect.objectContaining({
      errors: expect.objectContaining({ totalErrors: 1 }),
      events: expect.objectContaining({ count: 1 }),
      network: expect.objectContaining({ window5s: expect.any(Object) }),
    }),
  );
});

test('soft navigate updates the URL and view, which survive a reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#status-text')).toHaveText('running');
  await expect(page.locator('#view-title')).toHaveText('Home');

  await page.locator('#soft-nav-button').click();
  await expect(page).toHaveURL(/\/\?view=orders$/);
  await expect(page.locator('#view-title')).toHaveText('Orders');

  await page.locator('#soft-nav-button').click();
  await expect(page.locator('#view-title')).toHaveText('Customers');

  await page.goBack();
  await expect(page.locator('#view-title')).toHaveText('Orders');

  await page.reload();
  await expect(page.locator('#view-title')).toHaveText('Orders');
});
