/**
 * Loads the monorepo root .env into process.env. MUST be the very first
 * import in index.ts — see packages/db/src/load-env.ts's doc comment for
 * why (ES module evaluation order: index.ts's `import { db } from
 * '@osint/db'` would otherwise have already caused @osint/db's client.ts
 * to read process.env.DATABASE_URL before this ever ran).
 */
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) })
