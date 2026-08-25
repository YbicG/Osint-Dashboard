import './load-env.js' // must stay the first import — see load-env.ts's doc comment
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const connectionString = process.env.DATABASE_URL ?? 'postgres://osint:osint_dev_password@localhost:55432/osint'

// Resolved from this file's own location, not the process CWD. `pnpm
// --filter @osint/db db:migrate` happens to set CWD to this package today,
// so a relative './migrations' has worked so far — but that's a property
// of how it's invoked, not of this script, and breaks the moment this is
// called from a different CWD (a compiled entrypoint, another package's
// script, a deploy container's working directory).
const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../migrations')

async function main() {
  const sql = postgres(connectionString, { max: 1 })
  const db = drizzle(sql)
  console.log(`Running migrations against ${connectionString.replace(/:[^:@]+@/, ':***@')} ...`)
  await migrate(db, { migrationsFolder })
  console.log('Migrations complete.')
  await sql.end()
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
