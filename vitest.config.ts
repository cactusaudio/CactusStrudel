import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    // .tsx too: component tests were silently skipped by the repo gate
    // while passing in their own package run.
    include: [
      'packages/*/src/**/*.test.{ts,tsx}',
      'packages/*/test/**/*.test.{ts,tsx}',
      'apps/*/src/**/*.test.{ts,tsx}',
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 30000,
  },
});
