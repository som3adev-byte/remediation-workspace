import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    globalSetup: ['test/helpers/global-setup.ts'],
    setupFiles: ['test/helpers/env.ts'],
    // One real Postgres test database: files run one after another so a file's
    // truncate + reseed never races another file.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
