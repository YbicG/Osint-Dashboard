import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Only unit tests here — anything touching real Postgres/Redis belongs
    // in the (not-yet-built, see docs/PLAN.md's M10) integration config.
    exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
  },
})
