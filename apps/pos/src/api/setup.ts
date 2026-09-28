import { and, desc, eq, lte } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'

export const PROMPTPAY_SETTING_KEY = 'promptpay.id'

/** setting is keyed by (key, effective_from) (D47 item 9): the value in force at `atIso` is the latest one not in the future. */
export async function getSetting(db: RemoteDb, key: string, atIso: string): Promise<unknown> {
  const row = await db
    .select()
    .from(s.setting)
    .where(and(eq(s.setting.key, key), lte(s.setting.effectiveFrom, atIso)))
    .orderBy(desc(s.setting.effectiveFrom))
    .limit(1)
    .get()
  return row?.valueJson ?? null
}
