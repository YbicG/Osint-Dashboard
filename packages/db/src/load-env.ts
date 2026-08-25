/**
 * Loads the monorepo root .env into process.env. Must be the FIRST import
 * in any entrypoint that reads env vars at module scope (migrate.ts,
 * seed.ts, and apps/worker's index.ts) — NOT a later statement in the same
 * file, and NOT something imported after other imports that themselves
 * read process.env at their own module scope.
 *
 * Why this matters: ES module evaluation runs all of a module's imports to
 * completion, in the order written, BEFORE any of that module's own
 * top-level statements execute. apps/worker/src/index.ts does
 * `import { db } from '@osint/db'`, and @osint/db's client.ts reads
 * `process.env.DATABASE_URL` at ITS OWN module scope. If this loader were
 * imported anywhere after that `@osint/db` import — or worse, called as a
 * plain function from inside index.ts's body — client.ts would already
 * have read (and permanently captured, via `const`) whatever DATABASE_URL
 * was set BEFORE .env got loaded. Only Next.js's own bootstrap auto-loads
 * .env for apps/web; every other entrypoint (worker, db CLI scripts) is
 * plain tsx with no such magic, which is exactly the bug this file exists
 * to close — a real one, hit during development: SEED_ADMIN_PASSWORD from
 * .env was silently ignored by `pnpm db:seed` because nothing ever loaded
 * .env for that process, and the seed script's `?? 'change-me-immediately'`
 * fallback ran instead.
 */
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) })
