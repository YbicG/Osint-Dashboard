import type { NextRequest } from 'next/server'
import { getCurrentUser } from '@/server/auth'
import { createSubscriberConnection, searchEventChannel } from '@/server/queue'

export const dynamic = 'force-dynamic'

/**
 * Server-Sent Events relay: subscribes to this search's Redis pub/sub
 * channel (published by apps/worker as connectors run) and forwards every
 * message straight to the browser as an SSE `message` event. One Redis
 * connection per open browser tab — acceptable at this platform's scale;
 * revisit with a shared multiplexed subscriber if concurrent live searches
 * ever get into the hundreds.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const { id } = await params
  const subscriber = createSubscriberConnection()
  const channel = searchEventChannel(id)

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()
      controller.enqueue(encoder.encode(`event: connected\ndata: {}\n\n`))

      subscriber.subscribe(channel).catch((err) => {
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ message: String(err) })}\n\n`))
      })

      subscriber.on('message', (_ch, message) => {
        controller.enqueue(encoder.encode(`data: ${message}\n\n`))
        try {
          const parsed = JSON.parse(message)
          if (parsed.type === 'search_complete' || parsed.type === 'search_error') {
            controller.enqueue(encoder.encode(`event: done\ndata: {}\n\n`))
            controller.close()
          }
        } catch {
          // non-JSON message — ignore, already relayed above
        }
      })
    },
    cancel() {
      subscriber.unsubscribe(channel).catch(() => {})
      subscriber.quit().catch(() => {})
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
