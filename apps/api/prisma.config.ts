import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

// Single root .env is the source of truth for the whole workspace.
loadEnv({ path: path.resolve(import.meta.dirname, '..', '..', '.env'), quiet: true });

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'pnpm run seed',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
