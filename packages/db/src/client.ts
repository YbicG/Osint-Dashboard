import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema/index'

const connectionString = process.env.DATABASE_URL ?? 'postgres://osint:osint_dev_password@localhost:55432/osint'

// A single shared connection pool per process. Workers and the Next.js
// server each own their own instance of this module (no cross-process
// singleton needed — postgres-js pools per-process already).
const queryClient = postgres(connectionString, { max: 10 })

export const db = drizzle(queryClient, { schema })
export type Database = typeof db
export { schema }

// The raw postgres.js client, not wrapped by Drizzle. Needed for
// COPY FROM STDIN (`pgClient\`copy ...\`.writable()`) -- Drizzle's own
// `sql` helper builds query fragments for `db.execute()`, it doesn't expose
// COPY. Used by apps/worker/src/csv/index-file.ts for bulk CSV loads; see
// docs/RUNBOOK.md's "Bulk-loading very large CSV files" section.
export const pgClient = queryClient
