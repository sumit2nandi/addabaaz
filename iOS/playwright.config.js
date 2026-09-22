import { defineConfig } from '@playwright/test';

export default defineConfig({
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }, { name: 'webkit', use: { browserName: 'webkit', launchOptions: {} } }],
  testDir: './tests',
  timeout: 30000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3002',
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    trace: 'retain-on-failure',
    launchOptions: process.env.CHROMIUM_PATH ? {
      executablePath: process.env.CHROMIUM_PATH,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    } : {}
  },
  webServer: [
    { command: 'node ../tests/support/server.js', url: 'http://127.0.0.1:3000', reuseExistingServer: !process.env.CI },
    { command: 'node scripts/preview.mjs', url: 'http://127.0.0.1:3002', reuseExistingServer: !process.env.CI }
  ]
});
