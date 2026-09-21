import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3001',
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    trace: 'retain-on-failure',
    launchOptions: process.env.CHROMIUM_PATH ? {
      executablePath: process.env.CHROMIUM_PATH,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    } : {}
  },
  webServer: {
    command: 'npx http-server www -a 0.0.0.0 -p 3001 -c-1',
    url: 'http://127.0.0.1:3001',
    reuseExistingServer: !process.env.CI
  }
});
