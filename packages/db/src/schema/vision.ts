import { pgTable, uuid, timestamp, real, jsonb, index } from 'drizzle-orm/pg-core'
import { vector } from './custom-types'
import { entity } from './entity'
import { claim } from './claim'

/**
 * ArcFace embeddings (512-dim) for every detected face, keyed to the image
 * entity/claim that produced it. Cross-source face clustering is a pgvector
 * cosine-distance query over this table, scoped to a case for biometric
 * purge on close (see appliesBiometricGate in packages/core).
 */
export const faceEmbedding = pgTable('face_embedding', {
  id: uuid('id').primaryKey().defaultRandom(),
  imageEntityId: uuid('image_entity_id').notNull().references(() => entity.id, { onDelete: 'cascade' }),
  sourceClaimId: uuid('source_claim_id').notNull().references(() => claim.id, { onDelete: 'cascade' }),
  embedding: vector('embedding', { dimensions: 512 }),
  boundingBox: jsonb('bounding_box').notNull(), // {x, y, width, height} normalized 0-1
  detectionConfidence: real('detection_confidence').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  /** Set when the owning case closes and the biometric purge job runs. */
  purgedAt: timestamp('purged_at', { withTimezone: true }),
}, (t) => [
  index('face_embedding_image_idx').on(t.imageEntityId),
])
