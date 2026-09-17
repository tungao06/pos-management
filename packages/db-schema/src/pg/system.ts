import { index, pgTable } from 'drizzle-orm/pg-core'
import { bool, id, json, text } from './columns.js'

export const auditLog = pgTable('audit_log', {
  id: id(),
  entity: text('entity').notNull(),
  entityId: text('entity_id').notNull(),
  action: text('action').notNull(),
  beforeJson: json('before_json'),
  afterJson: json('after_json'),
  actorUserId: text('actor_user_id'),
  at: text('at').notNull(),
}, (t) => [index('audit_log_entity_idx').on(t.entity, t.entityId)])

/** Server-only: idempotent push (spec §6.1). */
export const idempotencyRecord = pgTable('idempotency_record', {
  key: text('key').primaryKey(),
  firstSeenAt: text('first_seen_at').notNull(),
  resultHash: text('result_hash').notNull(),
})

/** Server-only: nightly invariant results (spec §7). */
export const invariantRun = pgTable('invariant_run', {
  id: id(),
  ranAt: text('ran_at').notNull(),
  resultsJson: json('results_json').notNull(),
  hasFailure: bool('has_failure').notNull(),
})
