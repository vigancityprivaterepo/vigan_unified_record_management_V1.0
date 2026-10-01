import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 15000,
    hookTimeout: 15000,
    // Tests share one real Postgres DB (advisory locks / pg_trgm can't be
    // mocked) -- run files sequentially so one file's table reset doesn't
    // race another file's assertions.
    fileParallelism: false,
  },
});
