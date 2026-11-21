import { defineConfig } from '@playwright/test';

// Server-mode E2E: boots the Fastify server (serving the BUILT app) and runs
// the whole suite against http://127.0.0.1:<port> in server storage mode.
const port = Number(process.env.E2E_SERVER_PORT ?? 8080);
const base = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/server.spec.ts', // server-mode job runs only this suite
  timeout: 90_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: base,
    headless: true,
  },
  webServer: {
    command: `npx tsx apps/server/src/index.ts`,
    url: `${base}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      PORT: String(port),
      OPENARCH_DATA: process.env.OPENARCH_DATA ?? '/tmp/openarch-e2e-models.json',
      OPENARCH_REQUIRE_AUTH: 'false',
    },
  },
});
