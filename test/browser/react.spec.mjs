import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { build } from 'esbuild';

const fixture = (path) => fileURLToPath(new URL(path, import.meta.url));
const react19 = fixture('./react-19/node_modules/');

// React 18 comes from the root devDependencies; React 19 from the isolated fixture package.
const versions = {
  'React 18': {},
  'React 19': { react: `${react19}react`, 'react-dom': `${react19}react-dom` },
};

async function bundle(alias) {
  const result = await build({
    entryPoints: [fixture('./fixtures/react-app.mjs')],
    bundle: true,
    format: 'esm',
    write: false,
    alias,
    // Development builds expose actualDuration, which the collector needs.
    define: { 'process.env.NODE_ENV': '"development"' },
  });

  return result.outputFiles[0].text;
}

for (const [name, alias] of Object.entries(versions)) {
  test(`${name}: counts real renders and self durations`, async ({ page }) => {
    const script = await bundle(alias);

    await page.route('http://react.test/**', (route) =>
      route.request().url().endsWith('/app.js')
        ? route.fulfill({ contentType: 'text/javascript', body: script })
        : route.fulfill({
            contentType: 'text/html',
            body: '<div id="root"></div><script type="module" src="/app.js"></script>',
          }),
    );
    await page.goto('http://react.test/');
    await expect(page.locator('#increment')).toHaveText('0');

    for (let clicks = 1; clicks <= 3; clicks++) {
      await page.locator('#increment').click();
      await expect(page.locator('#increment')).toHaveText(String(clicks));
    }

    await page.locator('#hide').click();
    await expect(page.locator('#increment')).toHaveCount(0);

    const snapshot = await page.evaluate(() => window.reactMonitor.react.snapshot.value);
    const mounts = Object.fromEntries(
      snapshot.entries
        .filter((entry) => entry.type === 'mount')
        .map((entry) => [entry.component, entry.duration]),
    );

    // Memoized Heavy and App (whose state only changes on hide) must not count bailouts.
    expect(snapshot.byComponent.Heavy?.renders).toBe(1);
    expect(snapshot.byComponent.App?.renders).toBe(2);
    expect(snapshot.byComponent.Counter?.renders).toBe(4);
    expect(
      snapshot.entries.some((entry) => entry.component === 'Counter' && entry.type === 'unmount'),
    ).toBe(true);

    // App's own mount time excludes the ~8 ms spent in Heavy.
    expect(mounts.Heavy).toBeGreaterThanOrEqual(7);
    expect(mounts.App).toBeLessThan(mounts.Heavy);
  });
}
