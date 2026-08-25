import './load-env.js' // must stay the first import — see load-env.ts's doc comment
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { randomBytes, scrypt as scryptCb } from 'node:crypto'
import { promisify } from 'node:util'
import { org, appUser } from './schema/index.js'
import * as schema from './schema/index.js'

const scrypt = promisify(scryptCb)

// Duplicated from packages/core/src/auth/password.ts rather than imported —
// @osint/core depends on @osint/db (for the audit hash-chain and merge
// helpers), so importing @osint/core from here would create a circular
// package dependency. This is ~6 lines; not worth restructuring two
// packages over.
async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer
  return `scrypt:${salt.toString('hex')}:${derivedKey.toString('hex')}`
}

/**
 * Idempotent dev seed: one org, one admin user, and the connector source
 * registry pre-populated (so the source-health dashboard has rows to show
 * even before the first search runs). Safe to re-run — every insert checks
 * for an existing row first rather than relying on unique-constraint
 * failures, so a partial prior run doesn't need a reset.
 */
async function main() {
  const connectionString = process.env.DATABASE_URL ?? 'postgres://osint:osint_dev_password@localhost:55432/osint'
  const sql = postgres(connectionString, { max: 1 })
  const db = drizzle(sql, { schema })

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@localhost'
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'change-me-immediately'

  let [defaultOrg] = await db.select().from(org).limit(1)
  if (!defaultOrg) {
    ;[defaultOrg] = await db.insert(org).values({ name: 'Default Organization' }).returning()
    console.log(`Created org: ${defaultOrg!.name} (${defaultOrg!.id})`)
  }

  const existingAdmins = await db.select().from(appUser)
  const existingAdmin = existingAdmins.find((u) => u.email === adminEmail.toLowerCase())
  if (!existingAdmin) {
    const passwordHash = await hashPassword(adminPassword)
    const [created] = await db.insert(appUser).values({
      orgId: defaultOrg!.id,
      email: adminEmail.toLowerCase(),
      displayName: 'Administrator',
      role: 'admin',
      passwordHash,
    }).returning()
    console.log(`Created admin user: ${created!.email}`)
    if (!process.env.SEED_ADMIN_PASSWORD) {
      console.log(`  ⚠ Using default password "${adminPassword}" — set SEED_ADMIN_PASSWORD before seeding a real deployment.`)
    }
  } else {
    console.log(`Admin user already exists: ${existingAdmin.email}`)
  }

  // The connector source registry itself is no longer seeded here — it's
  // owned by apps/worker/src/sources/sync.ts's syncSourceRegistry(), which
  // runs on every worker startup and as a standalone script
  // (`pnpm --filter @osint/worker sync-sources`), reading directly from
  // CONNECTOR_REGISTRY so there is exactly one place connector metadata
  // lives. This used to be a hand-maintained mirror list here that could
  // (and did) drift from the real registry — see docs/RUNBOOK.md.

  await sql.end()
  console.log('Seed complete.')
}

main().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
