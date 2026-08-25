import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { csvSourceFolder } from '@osint/db/schema'
import { getCurrentUser } from '@/server/auth'
import { db } from '@/server/db'

/**
 * Minimal folder list for the search tab's filter dropdown. Deliberately
 * separate from GET /api/admin/csv-sources, which is role-gated and returns
 * server filesystem paths — this route is open to any authenticated role
 * and only ever returns {id, label}.
 */
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const folders = await db.select({ id: csvSourceFolder.id, label: csvSourceFolder.label })
    .from(csvSourceFolder)
    .where(eq(csvSourceFolder.enabled, true))
    .orderBy(csvSourceFolder.label)

  return NextResponse.json({ folders })
}
