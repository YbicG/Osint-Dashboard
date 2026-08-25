import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { randomBytes, scrypt as scryptCb } from 'node:crypto'
import { promisify } from 'node:util'
import { org, appUser, source } from './schema/index.js'
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

  // Kept as a hand-maintained mirror of packages/connectors/src/registry/index.ts
  // rather than importing CONNECTOR_REGISTRY directly: @osint/connectors depends
  // on @osint/core, which depends on @osint/db (audit hash-chain, merge helpers)
  // — importing connectors from here would create a circular package
  // dependency. Adding a new connector means adding one line here too; this
  // list only seeds the source-health dashboard's initial rows (getOrCreateSource
  // in apps/worker also upserts one automatically on first real run either way),
  // so drift here is cosmetic, not a functional gap.
  const CONNECTOR_SOURCES: { connectorId: string; name: string; category: string; costType: string; jurisdiction?: string }[] = [
    { connectorId: 'sanctions.ofac_sdn', name: 'OFAC Specially Designated Nationals List', category: 'sanctions_watchlists', costType: 'free' },
    { connectorId: 'federal.fbi_wanted', name: 'FBI Wanted', category: 'federal', costType: 'free' },
    { connectorId: 'federal.sec_edgar_fulltext', name: 'SEC EDGAR Full-Text Search', category: 'federal', costType: 'free' },
    { connectorId: 'federal.courtlistener', name: 'CourtListener (RECAP/PACER + Case Law)', category: 'courts_corrections', costType: 'free' },
    { connectorId: 'digital.username_enumeration', name: 'Username Enumeration (Sherlock/Maigret-style)', category: 'digital', costType: 'free' },
    { connectorId: 'digital.rdap', name: 'RDAP Domain Registration Lookup', category: 'digital', costType: 'free' },
    { connectorId: 'digital.certificate_transparency', name: 'Certificate Transparency (crt.sh)', category: 'digital', costType: 'free' },
    { connectorId: 'digital.ip_geolocation', name: 'IP Geolocation & Proxy Detection', category: 'digital', costType: 'free' },
    { connectorId: 'consumer_api.twilio_lookup', name: 'Twilio Lookup (line type, carrier, caller name)', category: 'consumer_api', costType: 'paid_api' },

    { connectorId: 'federal.nhtsa_vin', name: 'NHTSA vPIC VIN Decoder', category: 'federal', costType: 'free' },
    { connectorId: 'federal.usaspending', name: 'USAspending.gov Federal Contracts & Grants', category: 'federal', costType: 'free' },
    { connectorId: 'federal.propublica_nonprofit', name: 'ProPublica Nonprofit Explorer (IRS Form 990)', category: 'federal', costType: 'free' },
    { connectorId: 'federal.npi_registry', name: 'NPPES NPI Registry (Healthcare Providers)', category: 'business_professional', costType: 'free' },
    { connectorId: 'federal.hhs_oig_exclusions', name: 'HHS-OIG List of Excluded Individuals/Entities (LEIE)', category: 'sanctions_watchlists', costType: 'free' },
    { connectorId: 'vital.ssdi', name: 'WikiTree Deceased-Person Search (free SSDI/DMF substitute)', category: 'vital_genealogy', costType: 'free' },
    { connectorId: 'federal.faa_airmen', name: 'FAA Airmen Certification Database', category: 'business_professional', costType: 'free' },
    { connectorId: 'federal.fcc_uls', name: 'FCC Universal Licensing System', category: 'business_professional', costType: 'free' },
    { connectorId: 'business.opencorporates', name: 'OpenCorporates Company Search', category: 'business_professional', costType: 'freemium' },
    { connectorId: 'digital.shodan', name: 'Shodan Host Lookup', category: 'consumer_api', costType: 'paid_api' },
    { connectorId: 'sanctions.un_consolidated', name: 'UN Security Council Consolidated Sanctions List', category: 'sanctions_watchlists', costType: 'free' },
    { connectorId: 'sanctions.uk_hmt', name: 'UK Sanctions List (OFSI successor)', category: 'sanctions_watchlists', costType: 'free' },
  ]

  const existingSources = await db.select({ connectorId: source.connectorId }).from(source)
  const existingIds = new Set(existingSources.map((s) => s.connectorId))

  for (const s of CONNECTOR_SOURCES) {
    if (existingIds.has(s.connectorId)) continue
    await db.insert(source).values({
      connectorId: s.connectorId,
      name: s.name,
      category: s.category as never,
      costType: s.costType as never,
      jurisdiction: s.jurisdiction ?? null,
      robotsPolicy: 'honor',
      enabled: true,
    })
    console.log(`Registered source: ${s.name}`)
  }

  await sql.end()
  console.log('Seed complete.')
}

main().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
