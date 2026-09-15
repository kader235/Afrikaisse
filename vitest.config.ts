import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'services/*/test/**/*.test.ts', 'apps/site/test/**/*.test.ts', 'apps/desktop/test/**/*.test.ts', 'infrastructure/windows/test/**/*.test.ts'],
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
