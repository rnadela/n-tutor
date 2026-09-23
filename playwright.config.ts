import { defineConfig, devices } from '@playwright/test';
import { e2eDatabaseUrl } from './e2e/database';

const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
const API_ORIGIN = `http://localhost:${process.env.API_PORT ?? '3001'}`;

/** Tier-2 E2E: full stack, real Postgres, no AI module in scope (AD-22). */
export default defineConfig({
  testDir: './e2e/tests',
  outputDir: './e2e/test-results',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  use: {
    baseURL: WEB_ORIGIN,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm run e2e:prepare && pnpm --filter api run start',
      // Playwright replaces the environment wholesale when `env` is given.
      env: {
        ...(process.env as Record<string, string>),
        DATABASE_URL: e2eDatabaseUrl(),
        // Rate limiting has its own Tier-1 spec; here it would only throttle the
        // suite's own repeated sign-ins.
        AUTH_RATE_LIMIT: '1000',
        API_RATE_LIMIT: '10000',
      },
      url: `${API_ORIGIN}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter web run start',
      url: WEB_ORIGIN,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
