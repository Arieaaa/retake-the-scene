import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/server',
  testMatch: '**/*.spec.ts',
  workers: 1,
  timeout: 30000,
  outputDir: 'backend-test-results',
  use: { baseURL: 'http://127.0.0.1:5175', viewport: { width: 360, height: 780 },
    reducedMotion: 'reduce', channel: process.env.PLAYWRIGHT_CHANNEL, trace: 'off' },
  webServer: { command: 'npm run dev:site', url: 'http://127.0.0.1:5175', reuseExistingServer: false,
    env: { RETAKE_PORT: '5175', RETAKE_DB_PATH: ':memory:' } },
});
