import { index, sqliteTable } from 'drizzle-orm/sqlite-core'
import { id, int, json, text } from './columns.js'

export const auditLog = sqliteTable('audit_log', {
  id: id(),
  entity: text('entity').notNull(),
  entityId: text('entity_id').notNull(),
  action: text('action').notNull(),                 // create | update | deactivate
  beforeJson: json('before_json'),
  afterJson: json('after_json'),
  actorUserId: text('actor_user_id'),
  at: text('at').notNull(),
}, (t) => [index('audit_log_entity_idx').on(t.entity, t.entityId)])

/** Local-only: transaction rows waiting to be pushed (spec §6.1). */
export const outbox = sqliteTable('outbox', {
  id: id(),
  tableName: text('table_name').notNull(),
  rowJson: json('row_json').notNull(),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  createdAt: text('created_at').notNull(),
  attempts: int('attempts').notNull(),
  lastError: text('last_error'),
  sentAt: text('sent_at'),
}, (t) => [index('outbox_pending_idx').on(t.sentAt, t.createdAt)])

/** Local-only: pull cursors and last sync timestamps. */
export const syncState = sqliteTable('sync_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})
