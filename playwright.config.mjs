import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test/browser',
  fullyParallel: true,
  timeout: 30_000,
  webServer: {
    command: 'node demo/server.mjs --port 4177',
    url: 'http://127.0.0.1:4177',
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:4177',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
