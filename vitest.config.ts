import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // The first test in a file boots in-process Postgres and runs the migrations.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
