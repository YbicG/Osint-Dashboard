import { defineConfig } from 'vitest/config'
// Opt-in suite that hits real endpoints — run via `pnpm test:live`, never
// part of the default `pnpm test` / CI gate. Feeds the source-health dashboard.
export default defineConfig({
  test: { environment: 'node', include: ['**/*.live.test.ts'], testTimeout: 30_000 },
})
