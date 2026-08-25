import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { searchRequest, collectionRun, source } from '@osint/db/schema'
import { getCurrentUser } from '@/server/auth'
import { db } from '@/server/db'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const [search] = await db.select().from(searchRequest).where(eq(searchRequest.id, id))
  if (!search) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const runs = await db.select({ run: collectionRun, source })
    .from(collectionRun)
    .innerJoin(source, eq(collectionRun.sourceId, source.id))
    .where(eq(collectionRun.searchId, id))

  return NextResponse.json({
    search: {
      id: search.id,
      inputType: search.inputType,
      inputPayload: search.inputPayload,
      subjectEntityId: search.subjectEntityId,
      createdAt: search.createdAt,
    },
    runs: runs.map((r) => ({
      connectorId: r.run.connectorId,
      sourceName: r.source.name,
      sourceCategory: r.source.category,
      status: r.run.status,
      claimsProduced: r.run.claimsProduced,
      errorMessage: r.run.errorMessage,
      startedAt: r.run.startedAt,
      finishedAt: r.run.finishedAt,
    })),
  })
}
