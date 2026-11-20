import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    maxWorkers: 4,
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
