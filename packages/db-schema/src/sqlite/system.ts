import { sql } from 'drizzle-orm'
import { check, index, sqliteTable } from 'drizzle-orm/sqlite-core'
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
 * row_json is frozen once the row is sent or closed_off_catalog (trigger outbox_row_json_frozen · spec 04 §6.1).
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
  nextAttemptAt: text('next_attempt_at'),   // not before this instant (backoff of a deferred/unanswered row — spec §6.3)
  parentKey: text('parent_key'),            // order_void waits for `order:<id>` (spec §6.2)
  resultJson: json('result_json'),          // E2 verdict data of an accepted/duplicate row
}, (t) => [
  index('outbox_pending_idx').on(t.createdAt).where(sql`status = 'pending'`),
  index('outbox_parent_idx').on(t.parentKey),
])

/** Local copy of E1 (spec 04 §4.4, §6.5): one row, replaced whole in one transaction when catalog_version changes. */
export const dayoCatalog = sqliteTable('dayo_catalog', {
  id: text('id').primaryKey(),                         // always 'current'
  catalogVersion: int('catalog_version').notNull(),
  catalogJson: json('catalog_json').notNull(),         // E1 data.catalog (OrderCatalog shape, no cost)
  staffJson: json('staff_json').notNull(),             // E1 data.staff
  clientJson: json('client_json'),                     // E1 data.client
  fetchedAt: text('fetched_at').notNull(),
}, (t) => [check('dayo_catalog_single_row_ck', sql`${t.id} = 'current'`)])

/** Local-only: pull cursors and last sync timestamps. */
export const syncState = sqliteTable('sync_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})
