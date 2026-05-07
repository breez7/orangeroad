import { defineConfig } from '@playwright/test';

/**
 * Orange Road — Playwright integration test config (issue #17).
 *
 * The test runner spawns three processes via webServer:
 *   - LM Studio mock on :11434 (mock-lmstudio.ts)
 *   - Backend on :3001 with LM_STUDIO_URL pointing at the mock
 *   - Frontend (vite) on :5173
 *
 * playthrough.spec.ts then drives a real headless Chromium against the FE.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    viewport: { width: 1280, height: 720 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
  webServer: [
    {
      command: 'bun run tests/fixtures/mock-lmstudio.ts',
      port: 11999,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 15_000,
    },
    {
      command: 'cd ../backend && PORT=3001 ALLOWED_ORIGINS=http://localhost:5173 LM_STUDIO_URL=http://localhost:11999/v1 LM_STUDIO_MODEL=mock LM_STUDIO_TIMEOUT_MS=10000 bun run src/server.ts',
      port: 3001,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 15_000,
    },
    {
      command: 'npx vite --port 5173 --host 127.0.0.1',
      port: 5173,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 30_000,
    },
  ],
});
