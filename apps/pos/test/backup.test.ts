import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { createPosApi } from '../src/api/pos-api'
import { isSqliteFile } from '../src/api/backup'
import type { BackupFileDto, CloseShiftInput, ConfirmBackupInput } from '../src/api/types'
import { hashPin } from '../src/lib/pin'
import { openReadyApi, PINS, TEST_PIN_COST, type ReadyApi } from './helpers/db'
import { COUNT_520, sellVoidScenario } from './helpers/shift'

const close520 = (t: ReadyApi): CloseShiftInput => ({
  actorUserId: t.owner.id, approverUserId: t.owner.id, approverPin: PINS.TungAo, countLines: COUNT_520, shownExpectedCashSatang: 52_000,
  varianceReason: null, bankQrTotalSatang: null, acknowledgeZChainBroken: false,
})
const confirmOf = (t: ReadyApi, file: BackupFileDto): ConfirmBackupInput => ({ actorUserId: t.owner.id, fileName: file.fileName, byteLength: file.bytes.byteLength, createdAt: file.createdAt, lastZId: file.lastZId })
const backupAudit = async (t: ReadyApi) => (await t.db.select().from(s.auditLog).all()).filter((a) => a.action === 'backup')

describe('exportBackup / confirmBackupSaved (spec §11 · spike I3 · Q3b-6/7 · D52 · review I-4)', () => {
  it('exports a complete SQLite copy named by device and Thai time, and records nothing until the owner confirms it', async () => {
    const t = await openReadyApi()
    await sellVoidScenario(t)
    t.clock.set('2026-09-17T13:10:00.000Z')
    const file = await t.api.exportBackup(t.owner.id)
    expect(file.fileName).toBe('dayo-pos-A-20260917-201000.sqlite3')
    expect(file.createdAt).toBe('2026-09-17T13:10:00.000Z')
    expect(file.lastZId).toBeNull() // no Z yet
    expect(isSqliteFile(file.bytes)).toBe(true)

    // the copy opens as a database holding every bill and the hash-chained events
    const path = join(mkdtempSync(join(tmpdir(), 'dayo-restore-')), file.fileName)
    writeFileSync(path, file.bytes)
    const copy = new DatabaseSync(path)
    expect(copy.prepare('select receipt_no, status from "order" order by receipt_no').all().map((r) => ({ ...r }))).toEqual([
      { receipt_no: 'A-000001', status: 'voided' },
      { receipt_no: 'A-000002', status: 'voided' },
      { receipt_no: 'A-000003', status: 'paid' },
    ])
    expect((copy.prepare('select count(*) as c from order_event').get() as { c: number }).c).toBeGreaterThan(0)
    copy.close()

    // I-4: a download gives no success signal — the export alone is not a backup
    expect((await t.api.bootstrap()).lastBackupAt).toBeNull()
    expect(await backupAudit(t)).toEqual([])

    t.clock.set('2026-09-17T13:12:00.000Z')
    await t.api.confirmBackupSaved(confirmOf(t, file))
    expect((await t.api.bootstrap()).lastBackupAt).toBe('2026-09-17T13:10:00.000Z') // the time of the data in the file
    expect(await backupAudit(t)).toEqual([
      {
        id: expect.any(String),
        entity: 'device',
        entityId: t.device.id,
        action: 'backup',
        beforeJson: null,
        afterJson: { fileName: file.fileName, bytes: file.bytes.byteLength, exportedAt: file.createdAt, lastZId: null },
        actorUserId: t.owner.id,
        at: '2026-09-17T13:12:00.000Z',
      },
    ])
  })

  it('backupDue: false before any Z, true after a close, still true after an export alone, false once confirmed (Q3b-7 · D52)', async () => {
    const t = await openReadyApi()
    await sellVoidScenario(t)
    const early = await t.api.exportBackup(t.owner.id) // taken before the close
    expect((await t.api.bootstrap()).backupDue).toBe(false)
    const z = await t.api.closeShift(close520(t))
    expect((await t.api.bootstrap()).backupDue).toBe(true)
    await t.api.confirmBackupSaved(confirmOf(t, early)) // a file without the latest Z does not clear the banner
    expect((await t.api.bootstrap()).backupDue).toBe(true)
    t.clock.advanceMs(1_000)
    const file = await t.api.exportBackup(t.owner.id)
    expect(file.lastZId).toBe(z.id)
    expect((await t.api.bootstrap()).backupDue).toBe(true)
    await t.api.confirmBackupSaved(confirmOf(t, file))
    expect((await t.api.bootstrap()).backupDue).toBe(false)
  })

  it('owner only (Q3b-13 · D53); a failing or non-SQLite export is BACKUP_FAILED; a confirmation must match an export — nothing recorded', async () => {
    const t = await openReadyApi()
    t.raw
      .prepare('insert into "user" (id, display_name, role, pin_hash, is_active, created_at, updated_at, version) values (?, ?, ?, ?, 1, ?, ?, 1)')
      .run('staff-1', 'พนักงาน', 'staff', await hashPin('3333', TEST_PIN_COST), t.clock.now(), t.clock.now())
    await expect(t.api.exportBackup('staff-1')).rejects.toThrow(/^NOT_OWNER: /)
    await expect(t.api.exportBackup('nobody')).rejects.toThrow(/^BAD_INPUT: /)
    const broken = createPosApi(t.db, { ...t.deps, exportDbFile: async () => { throw new Error('NotReadableError') } })
    await expect(broken.exportBackup(t.owner.id)).rejects.toThrow(/^BACKUP_FAILED: /)
    const garbage = createPosApi(t.db, { ...t.deps, exportDbFile: async () => new Uint8Array(4096) })
    await expect(garbage.exportBackup(t.owner.id)).rejects.toThrow(/^BACKUP_FAILED: /)

    const ok = confirmOf(t, await t.api.exportBackup(t.owner.id))
    await expect(t.api.confirmBackupSaved({ ...ok, actorUserId: 'staff-1' })).rejects.toThrow(/^NOT_OWNER: /)
    await expect(t.api.confirmBackupSaved({ ...ok, fileName: 'dayo-pos-B-20260917-100000.sqlite3' })).rejects.toThrow(/^BAD_INPUT: /)
    await expect(t.api.confirmBackupSaved({ ...ok, createdAt: 'yesterday' })).rejects.toThrow(/^BAD_INPUT: /)
    await expect(t.api.confirmBackupSaved({ ...ok, byteLength: 0 })).rejects.toThrow(/^BAD_INPUT: /)
    await expect(t.api.confirmBackupSaved({ ...ok, lastZId: 'no-such-z' })).rejects.toThrow(/^BAD_INPUT: /)
    expect((await t.api.bootstrap()).lastBackupAt).toBeNull()
    expect(await backupAudit(t)).toEqual([])
  })
})
