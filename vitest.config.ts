import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: process.env.CORTICO_TEST_ROOT ? [{ find: /^cortico\//, replacement: `${process.env.CORTICO_TEST_ROOT}/src/` }] : [] },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 10000, pool: 'forks', maxWorkers: 2, minWorkers: 1 },
});
