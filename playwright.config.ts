import { defineConfig } from '@playwright/test';

const live = process.env.RETAKE_TEST_LIVE === '1';
let baseURL = 'http://127.0.0.1:5173';
if (live) {
  if (!process.env.RETAKE_LIVE_URL) throw new Error('真实站点验收缺少 RETAKE_LIVE_URL；不会退回本机预演。');
  const url = new URL(process.env.RETAKE_LIVE_URL);
  const localHTTP = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((!localHTTP && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash) throw new Error('RETAKE_LIVE_URL 须为不含凭证、查询或片段的 HTTPS 站点根地址；本机门禁检查可使用 HTTP。');
  baseURL = url.href;
}

export default defineConfig({
  testDir: live ? './tests/live' : './tests/e2e',
  timeout: live ? 120000 : 30000,
  fullyParallel: !live,
  workers: live ? 1 : 2,
  outputDir: live ? 'test-results-live' : 'test-results',
  use: { channel: process.env.PLAYWRIGHT_CHANNEL, baseURL, viewport: { width: 360, height: 780 }, trace: live ? 'off' : 'retain-on-failure', screenshot: 'only-on-failure', reducedMotion: live ? 'reduce' : 'no-preference' },
  webServer: live ? undefined : [
    { command: 'npm run dev', url: 'http://127.0.0.1:5173', reuseExistingServer: true },
    { command: 'npx vite preview --outDir dist-site --host 127.0.0.1 --port 5174 --strictPort', url: 'http://127.0.0.1:5174', reuseExistingServer: false },
  ],
  projects: live ? [
    { name: 'preflight', testMatch: 'preflight.spec.ts' },
    { name: 'mobile', testMatch: 'game.spec.ts', dependencies: ['preflight'] },
  ] : undefined,
  reporter: [['list'], ['html', { open: 'never', outputFolder: live ? 'playwright-live-report' : 'playwright-report' }]],
});
