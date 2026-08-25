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
