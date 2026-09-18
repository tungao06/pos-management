import { sql } from 'drizzle-orm'
import { index, sqliteTable } from 'drizzle-orm/sqlite-core'
import { OutboxStatus } from '@dayo/contracts'
import { id, int, json, text, textEnum } from './columns.js'

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

/**
 * Local-only: transaction rows waiting to be pushed (spec §6.1). status pending → sent, or pending → dead when the
 * server rejects the row for good (dead-letter: dead_at + last_error, shown on the settings screen, never re-sent).
 */
export const outbox = sqliteTable('outbox', {
  id: id(),
  tableName: text('table_name').notNull(),
  rowJson: json('row_json').notNull(),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  status: textEnum('status', OutboxStatus).notNull().default('pending'),
  createdAt: text('created_at').notNull(),
  attempts: int('attempts').notNull(),
  lastError: text('last_error'),
  sentAt: text('sent_at'),
  deadAt: text('dead_at'),
}, (t) => [index('outbox_pending_idx').on(t.createdAt).where(sql`status = 'pending'`)])

/** Local-only: pull cursors and last sync timestamps. */
export const syncState = sqliteTable('sync_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})
