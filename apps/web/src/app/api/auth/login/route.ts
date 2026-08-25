import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { signIn } from '@/server/auth'

// Deliberately NOT z.string().email() — this endpoint checks a credential
// against an existing row, it doesn't register one, so it must accept
// whatever string is actually stored in app_user.email. That bit: Zod's
// .email() regex requires a dotted TLD-shaped domain and rejects the
// seeded default admin address ("admin@localhost", no dot in the domain
// part) with a 400 before signIn() ever runs — a real bug hit during
// development, not a hypothetical.
const LoginSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
})

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = LoginSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const user = await signIn(parsed.data.email, parsed.data.password, {
    ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
    userAgent: req.headers.get('user-agent') ?? undefined,
  })

  if (!user) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
  }

  return NextResponse.json({ user })
}
