import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    include: [
      'packages/*/src/**/*.test.ts',
      'packages/*/test/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 30000,
  },
});
