import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  // `tsconfig` leaves JSX for Next to transform, so the test runner has to be
  // told which runtime to use for the `.tsx` specs.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['src/**/*.spec.{ts,tsx}'],
  },
});
