import { cookies } from 'next/headers'
import { eq } from 'drizzle-orm'
import { verifyPassword, generateSessionToken, appendAuditEntry } from '@osint/core'
import { appUser, session as sessionTable } from '@osint/db/schema'
import { db } from './db'

const SESSION_COOKIE = 'osint_session'
const SESSION_TTL_MS = 12 * 60 * 60 * 1000 // 12 hours — short-lived by design for a tool handling sensitive PII

export interface AuthenticatedUser {
  id: string
  orgId: string
  email: string
  displayName: string
  role: 'admin' | 'supervisor' | 'analyst' | 'auditor'
}

export async function signIn(email: string, password: string, meta: { ipAddress?: string; userAgent?: string }): Promise<AuthenticatedUser | null> {
  const [user] = await db.select().from(appUser).where(eq(appUser.email, email.toLowerCase()))
  if (!user || user.disabledAt) return null

  const valid = await verifyPassword(password, user.passwordHash)
  if (!valid) return null

  const token = generateSessionToken()
  await db.insert(sessionTable).values({
    id: token,
    userId: user.id,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  })

  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  })

  await appendAuditEntry(db, { userId: user.id, action: 'auth.login', metadata: { ipAddress: meta.ipAddress ?? null } })

  return { id: user.id, orgId: user.orgId, email: user.email, displayName: user.displayName, role: user.role }
}

export async function signOut(): Promise<void> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (token) {
    await db.delete(sessionTable).where(eq(sessionTable.id, token))
    cookieStore.delete(SESSION_COOKIE)
  }
}

/** Returns the authenticated user for the current request, or null. Never throws — callers decide whether an anonymous request is allowed. */
export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (!token) return null

  const [row] = await db.select({ user: appUser, session: sessionTable })
    .from(sessionTable)
    .innerJoin(appUser, eq(sessionTable.userId, appUser.id))
    .where(eq(sessionTable.id, token))

  if (!row || row.session.expiresAt < new Date() || row.user.disabledAt) return null

  return { id: row.user.id, orgId: row.user.orgId, email: row.user.email, displayName: row.user.displayName, role: row.user.role }
}

export class UnauthorizedError extends Error {
  constructor() { super('Unauthorized') }
}

/** For route handlers/server components that must be authenticated — throws so a shared error boundary/catch block can turn it into a 401, rather than every caller re-checking null. */
export async function requireUser(): Promise<AuthenticatedUser> {
  const user = await getCurrentUser()
  if (!user) throw new UnauthorizedError()
  return user
}
