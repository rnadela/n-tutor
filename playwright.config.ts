import { defineConfig, devices } from '@playwright/test';
import { e2eDatabaseUrl } from './e2e/database';
import { MAIL_LOG_FILE } from './e2e/mail-sink';

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
        PARENT_AUTH_RATE_LIMIT: '1000',
        PARENT_JWT_SECRET:
          process.env.PARENT_JWT_SECRET ?? 'e2e-only-parent-secret-please-rotate-0123456789',
        COOKIE_SECURE: 'false',
        // Stated rather than inherited: the PIN suite asserts on a lock that
        // must still be in force when the page it locked is reloaded.
        PIN_COOLDOWN_MS: process.env.PIN_COOLDOWN_MS ?? '900000',
        ELEVATION_TTL_SECONDS: process.env.ELEVATION_TTL_SECONDS ?? '900',
        ELEVATION_CEILING_MS: process.env.ELEVATION_CEILING_MS ?? '28800000',
        WEB_ORIGIN,
        MAIL_TRANSPORT: 'log',
        MAIL_FROM: 'no-reply@example.test',
        // The E2E suite reads issued reset links out of this sink; nothing in
        // the product reads it.
        MAIL_LOG_FILE: MAIL_LOG_FILE,
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
