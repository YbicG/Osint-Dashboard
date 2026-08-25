import type Redis from 'ioredis'

export type SearchEvent =
  | { type: 'plan'; connectors: { id: string; name: string; category: string }[] }
  | { type: 'connector_status'; connectorId: string; connectorName: string; sourceId: string; status: string }
  | { type: 'claim_ingested'; connectorId: string; predicate: string; entityId: string }
  | { type: 'search_complete'; totalClaims: number; subjectEntityId: string }
  | { type: 'search_error'; message: string }

export function searchEventChannel(searchId: string): string {
  return `search:${searchId}:events`
}

/** Publishes one event for a search — the web app's SSE route subscribes to this same channel to relay live progress to the browser. */
export async function publishSearchEvent(redis: Redis, searchId: string, event: SearchEvent): Promise<void> {
  await redis.publish(searchEventChannel(searchId), JSON.stringify(event))
}
