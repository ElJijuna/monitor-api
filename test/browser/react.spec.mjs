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

async function bundle(alias, entry = './fixtures/react-app.mjs') {
  const result = await build({
    entryPoints: [fixture(entry)],
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

for (const [name, alias] of Object.entries(versions)) {
  test(`${name}: selector hooks commit only when the selection changes`, async ({ page }) => {
    const script = await bundle(alias, './fixtures/react-hooks-app.mjs');

    await page.route('http://react.test/**', (route) =>
      route.request().url().endsWith('/app.js')
        ? route.fulfill({ contentType: 'text/javascript', body: script })
        : route.fulfill({
            contentType: 'text/html',
            body: '<div id="root"></div><script type="module" src="/app.js"></script>',
          }),
    );
    await page.goto('http://react.test/');
    await expect(page.locator('#saves')).toHaveText('0');

    const commits = () => page.evaluate(() => ({ ...window.hooksTest.commits }));
    const initial = await commits();

    await page.evaluate(() => window.hooksTest.emit('open'));
    await expect(page.locator('#full')).toHaveText('1');
    await page.evaluate(() => window.hooksTest.emit('open'));
    await expect(page.locator('#full')).toHaveText('2');

    // Unrelated events re-render the full-snapshot component only; the summary changes once.
    expect(await commits()).toEqual({
      full: initial.full + 2,
      count: initial.count,
      object: initial.object + 1,
    });

    await page.evaluate(() => window.hooksTest.emit('save'));
    await expect(page.locator('#saves')).toHaveText('1');
    await expect(page.locator('#summary')).toHaveText('1/true');
    expect(await commits()).toEqual({
      full: initial.full + 3,
      count: initial.count + 1,
      object: initial.object + 2,
    });
  });
}
