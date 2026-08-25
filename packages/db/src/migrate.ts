import './load-env.js' // must stay the first import — see load-env.ts's doc comment
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const connectionString = process.env.DATABASE_URL ?? 'postgres://osint:osint_dev_password@localhost:55432/osint'

async function main() {
  const sql = postgres(connectionString, { max: 1 })
  const db = drizzle(sql)
  console.log(`Running migrations against ${connectionString.replace(/:[^:@]+@/, ':***@')} ...`)
  await migrate(db, { migrationsFolder: './migrations' })
  console.log('Migrations complete.')
  await sql.end()
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
