import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate, useNavigate } from '@tanstack/react-router'
import { useEffect, useState, type JSX } from 'react'
import type { Size, Sweetness } from '@dayo/dayo-pricing'
import type { RemapScope, Remedy, SellCatalogDto, SyncProblemDto } from '../api/types'
import { useApi } from '../app/api-context'
import { can } from '../app/permissions'
import { bootstrapKey, sellCatalogKey, syncProblemsKey, useBootstrap } from '../app/queries'
import { useSession } from '../app/session'
import { errorMessage } from '../ui/errors'
import { saveFile } from '../ui/save-file'
import { TH } from '../ui/th'
import { OwnerApprovalDialog, type OwnerApproval } from './OwnerApprovalDialog'

const TIME = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' })

/** `remapCode`'s target — the same union `RemapCodeInput['target']` (api/types.ts). */
type Target = { field: 'line'; lineIndex: number; code: string; size: Size; sweetness: Sweetness } | { field: 'channel'; code: string } | { field: 'payment'; code: string }

function dialogTitle(remedy: Remedy): string {
  if (remedy === 'RETRY') return TH.remedyRetry
  if (remedy === 'RENUMBER') return TH.remedyRenumber
  if (remedy === 'REMAP_CODE') return TH.remedyRemapCode
  if (remedy === 'REMAP_STAFF') return TH.remedyRemapStaff
  return TH.remedyExclude
}

/**
 * "เลือกรหัสแทน" (UNKNOWN_CODE): a menu/size/sweetness, a channel, or a payment method — never more than one field
 * per remedy (`remapCode`, Task 15 fix round 1 item 2). Sizes come from `catalog.sizes` active right now (ADR-0054,
 * "ปรับตาม dayo"), never a fixed list. Fix round code Low 3: `scope` (SyncProblemDto.remap — what dayo's own detail
 * named) opens the picker on that field and locks the other two; for a line, only the lines dayo named can be picked,
 * and when dayo named only their grade, menu/size/sweetness stay the line's own (remapCode then changes the grade). A
 * choice `remapCode` itself refuses (the value dayo refused, a payment that would flip cash↔non-cash) comes back as
 * `BAD_INPUT` with a Thai reason, shown as-is by `errorMessage` — never a raw error.
 */
function RemapCodeFields({ dto, scope, value, onChange }: { dto: SellCatalogDto; scope: RemapScope | null; value: Target | null; onChange: (t: Target | null) => void }): JSX.Element {
  const lockedField = scope?.field ?? null
  const namedLines = scope?.field === 'line' ? scope.lines : null
  const gradeOnly = scope?.field === 'line' && scope.gradeOnly
  const field = value?.field ?? lockedField ?? 'line'
  const menu = (value?.field === 'line' ? dto.menus.find((m) => m.code === value.code) : undefined) ?? dto.menus[0]
  const lineIndex = value?.field === 'line' ? value.lineIndex : (namedLines?.[0]?.index ?? 0)
  const size = (value?.field === 'line' ? value.size : undefined) ?? menu?.defaultSize
  const sweetness = (value?.field === 'line' ? value.sweetness : undefined) ?? menu?.defaultSweetness

  /** The choice a field opens with: a named line as it is (grade only), else the first menu's own defaults / first option. */
  const opening = (f: Target['field'], index = namedLines?.[0]?.index ?? 0): Target | null => {
    if (f === 'line') {
      const named = namedLines?.find((l) => l.index === index)
      if (gradeOnly && named !== undefined) return { field: 'line', lineIndex: named.index, code: named.code, size: named.size, sweetness: named.sweetness }
      return menu === undefined ? null : { field: 'line', lineIndex: index, code: menu.code, size: menu.defaultSize, sweetness: menu.defaultSweetness }
    }
    if (f === 'channel') {
      const c = dto.channels[0]
      return c === undefined ? null : { field: 'channel', code: c.code }
    }
    const p = dto.catalog.paymentMethods[0]
    return p === undefined ? null : { field: 'payment', code: p.code }
  }

  // A choice is required before "ยืนยัน" unlocks (`submitDisabled`, SyncProblemsScreen) — so the dialog opens with
  // one already made (on the field dayo named, else the first menu's own default size/sweetness) instead of forcing an
  // otherwise pointless tap.
  useEffect(() => {
    if (value === null) onChange(opening(lockedField ?? 'line'))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per mount of this dialog (a fresh `target` each time `remedy-remap-code` opens)
  }, [])

  const fieldButton = (f: Target['field'], testId: string, label: string): JSX.Element => (
    <button type="button" data-testid={testId} aria-pressed={field === f} disabled={lockedField !== null && lockedField !== f} onClick={() => onChange(opening(f))}>
      {label}
    </button>
  )
  const lineValue = value?.field === 'line' ? value : null
  const lineOptions = (namedLines ?? []).map((l) => (
    <option key={l.index} value={l.index}>
      {TH.remapCodeLineOption(l.index, l.code, l.size, l.sweetness)}
    </option>
  ))

  return (
    <div className="list">
      <div className="choices">
        {fieldButton('line', 'remap-code-field-line', TH.remapCodeFieldLine)}
        {fieldButton('channel', 'remap-code-field-channel', TH.remapCodeFieldChannel)}
        {fieldButton('payment', 'remap-code-field-payment', TH.remapCodeFieldPayment)}
      </div>
      {field === 'line' && gradeOnly && lineValue !== null && (
        <>
          <p>{TH.remapCodeGradeOnly}</p>
          <label>
            {TH.remapCodeLineIndex}
            <select data-testid="remap-code-line-index" value={lineValue.lineIndex} onChange={(e) => onChange(opening('line', Number(e.target.value)))}>
              {lineOptions}
            </select>
          </label>
          <label>
            {TH.remapCodeMenu}
            <select data-testid="remap-code-menu" value={lineValue.code} disabled>
              <option value={lineValue.code}>{dto.menus.find((m) => m.code === lineValue.code)?.nameTh ?? lineValue.code}</option>
            </select>
          </label>
          <label>
            {TH.remapCodeSize}
            <select data-testid="remap-code-size" value={lineValue.size} disabled>
              <option value={lineValue.size}>{dto.sizes.find((x) => x.code === lineValue.size)?.label ?? lineValue.size}</option>
            </select>
          </label>
          <label>
            {TH.remapCodeSweetness}
            <select data-testid="remap-code-sweetness" value={lineValue.sweetness} disabled>
              <option value={lineValue.sweetness}>{lineValue.sweetness}</option>
            </select>
          </label>
        </>
      )}
      {field === 'line' && !gradeOnly && menu !== undefined && size !== undefined && sweetness !== undefined && (
        <>
          <label>
            {TH.remapCodeLineIndex}
            {namedLines !== null ? (
              <select data-testid="remap-code-line-index" value={lineIndex} onChange={(e) => onChange({ field: 'line', lineIndex: Number(e.target.value), code: menu.code, size, sweetness })}>
                {lineOptions}
              </select>
            ) : (
              <input
                data-testid="remap-code-line-index"
                type="number"
                min={0}
                value={lineIndex}
                onChange={(e) => onChange({ field: 'line', lineIndex: Math.max(0, Math.trunc(Number(e.target.value))), code: menu.code, size, sweetness })}
              />
            )}
          </label>
          <label>
            {TH.remapCodeMenu}
            <select
              data-testid="remap-code-menu"
              value={menu.code}
              onChange={(e) => {
                const m = dto.menus.find((x) => x.code === e.target.value)
                if (m !== undefined) onChange({ field: 'line', lineIndex, code: m.code, size: m.defaultSize, sweetness: m.defaultSweetness })
              }}
            >
              {dto.menus.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.nameTh}
                </option>
              ))}
            </select>
          </label>
          <label>
            {TH.remapCodeSize}
            <select
              data-testid="remap-code-size"
              value={size}
              onChange={(e) => {
                const nextSize = e.target.value as Size
                const nextSweet = menu.sweetnessBySize[nextSize]?.[0] ?? sweetness
                onChange({ field: 'line', lineIndex, code: menu.code, size: nextSize, sweetness: nextSweet })
              }}
            >
              {menu.sizes.map((sz) => (
                <option key={sz} value={sz}>
                  {dto.sizes.find((x) => x.code === sz)?.label ?? sz}
                </option>
              ))}
            </select>
          </label>
          <label>
            {TH.remapCodeSweetness}
            <select data-testid="remap-code-sweetness" value={sweetness} onChange={(e) => onChange({ field: 'line', lineIndex, code: menu.code, size, sweetness: e.target.value as Sweetness })}>
              {(menu.sweetnessBySize[size] ?? []).map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {field === 'channel' && (
        <label>
          {TH.remapCodeFieldChannel}
          <select data-testid="remap-code-channel" value={value?.field === 'channel' ? value.code : ''} onChange={(e) => onChange({ field: 'channel', code: e.target.value })}>
            {dto.channels.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {field === 'payment' && (
        <label>
          {TH.remapCodeFieldPayment}
          <select data-testid="remap-code-payment" value={value?.field === 'payment' ? value.code : ''} onChange={(e) => onChange({ field: 'payment', code: e.target.value })}>
            {dto.catalog.paymentMethods.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  )
}

function RemapStaffFields({ options, value, onChange }: { options: { id: string; displayName: string }[]; value: string | null; onChange: (id: string) => void }): JSX.Element {
  return (
    <div className="choices">
      {options.map((o) => (
        <button key={o.id} type="button" data-testid={`remap-staff-${o.displayName}`} aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
          {o.displayName}
        </button>
      ))}
    </div>
  )
}

function ProblemRow({
  row,
  depth,
  excludeConfirmId,
  onRemedy,
  onExcludeAsk,
  onExport,
}: {
  row: SyncProblemDto
  depth: number
  excludeConfirmId: string | null
  onRemedy: (row: SyncProblemDto, remedy: Remedy) => void
  onExcludeAsk: (outboxId: string | null) => void
  onExport: (row: SyncProblemDto) => void
}): JSX.Element {
  const isClockAhead = row.reason === 'CLOCK_AHEAD'
  const testId = `problem-${row.receiptNo ?? row.key}`
  return (
    <div className="row" style={{ marginLeft: depth * 16 }}>
      <div data-testid={testId}>
        <span>{TH.syncProblemKind[row.kind] ?? row.kind}</span>
        <span>
          {' '}
          · {row.receiptNo ?? row.key} · {TIME.format(new Date(row.at))}
        </span>
        <span> · {TH.syncProblemDetail(row.detail)}</span>
        {isClockAhead && (
          <>
            {' '}
            <span className="badge">{TH.syncProblemClockAheadTag}</span>
            <p>{TH.syncProblemClockAheadHint}</p>
          </>
        )}
        {row.remapHint !== null && <p data-testid="problem-remap-hint">{row.remapHint}</p>}
        <div className="actions">
          {row.remedies.includes('RETRY') && (
            <button type="button" data-testid="remedy-retry" onClick={() => onRemedy(row, 'RETRY')}>
              {TH.remedyRetry}
            </button>
          )}
          {row.remedies.includes('RENUMBER') && (
            <button type="button" data-testid="remedy-renumber" onClick={() => onRemedy(row, 'RENUMBER')}>
              {TH.remedyRenumber}
            </button>
          )}
          {row.remedies.includes('REMAP_CODE') && (
            <button type="button" data-testid="remedy-remap-code" onClick={() => onRemedy(row, 'REMAP_CODE')}>
              {TH.remedyRemapCode}
            </button>
          )}
          {row.remedies.includes('REMAP_STAFF') && (
            <button type="button" data-testid="remedy-remap-staff" onClick={() => onRemedy(row, 'REMAP_STAFF')}>
              {TH.remedyRemapStaff}
            </button>
          )}
          {row.remedies.includes('EXCLUDE') &&
            (excludeConfirmId === row.outboxId ? (
              <>
                <p role="alert" className="error">
                  {isClockAhead ? TH.syncExcludeClockAheadWarning : TH.syncExcludeWarning}
                </p>
                <button
                  type="button"
                  data-testid="exclude-confirm"
                  onClick={() => {
                    onExcludeAsk(null)
                    onRemedy(row, 'EXCLUDE')
                  }}
                >
                  {TH.syncExcludeConfirm}
                </button>
              </>
            ) : (
              <button type="button" data-testid="remedy-exclude" onClick={() => onExcludeAsk(row.outboxId)}>
                {TH.remedyExclude}
              </button>
            ))}
          <button type="button" data-testid="remedy-export" onClick={() => onExport(row)}>
            {TH.remedyExport}
          </button>
        </div>
      </div>
      {row.children.map((c) => (
        <ProblemRow key={c.key} row={c} depth={depth + 1} excludeConfirmId={excludeConfirmId} onRemedy={onRemedy} onExcludeAsk={onExcludeAsk} onExport={onExport} />
      ))}
    </div>
  )
}

/**
 * spec §6.4 (owner only — ruling R11, checked here AND server-side by `listSyncProblems` itself, review item 22):
 * every dead E2 row, plus a far-ahead pending one (ruling N5, EXCLUDE only) — oldest first, a `PARENT_REJECTED`
 * child nested under its parent. No delete button anywhere on this page (spec §6.4 — a remedy always keeps the
 * row, never removes it).
 */
export function SyncProblemsScreen(): JSX.Element {
  const api = useApi()
  const navigate = useNavigate()
  const { user } = useSession()
  const boot = useBootstrap()
  const queryClient = useQueryClient()
  const allowed = user !== null && can(user.role, 'sync_problems')

  const problems = useQuery({ queryKey: syncProblemsKey(user?.id ?? ''), queryFn: () => api.listSyncProblems(user?.id ?? ''), enabled: allowed })
  const sellCatalog = useQuery({ queryKey: sellCatalogKey, queryFn: () => api.loadSellCatalog(), enabled: allowed })

  const [dialog, setDialog] = useState<{ row: SyncProblemDto; remedy: Remedy } | null>(null)
  const [target, setTarget] = useState<Target | null>(null)
  const [newStaffId, setNewStaffId] = useState<string | null>(null)
  const [excludeConfirmId, setExcludeConfirmId] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)

  const owners = boot.data?.users.filter((u) => u.role === 'owner') ?? []
  const staffOptions = [...(boot.data?.users ?? []), ...(boot.data?.staffNeedingPin ?? [])].filter((u, i, arr) => arr.findIndex((x) => x.id === u.id) === i)

  const closeDialog = (): void => {
    setDialog(null)
    setTarget(null)
    setNewStaffId(null)
  }

  const mutation = useMutation({
    mutationFn: async (approval: OwnerApproval): Promise<void> => {
      if (dialog === null) return
      const { row, remedy } = dialog
      if (remedy === 'RETRY') {
        await api.retrySyncRow({ ...approval, outboxId: row.outboxId })
      } else if (remedy === 'RENUMBER') {
        await api.renumberReceipt({ ...approval, outboxId: row.outboxId })
      } else if (remedy === 'REMAP_CODE') {
        if (target === null) throw new Error('choose a target first')
        await api.remapCode({ ...approval, outboxId: row.outboxId, target })
      } else if (remedy === 'REMAP_STAFF') {
        if (newStaffId === null) throw new Error('choose a staff member first')
        await api.remapStaff({ ...approval, outboxId: row.outboxId, newStaffId })
      } else {
        await api.excludeFromSync({ ...approval, outboxId: row.outboxId })
      }
    },
    onSuccess: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: syncProblemsKey(user?.id ?? '') }), queryClient.invalidateQueries({ queryKey: bootstrapKey })])
      closeDialog()
    },
  })

  const doExport = async (row: SyncProblemDto): Promise<void> => {
    if (user === null) return
    setExportError(null)
    try {
      const text = await api.exportSyncRow({ actorUserId: user.id, outboxId: row.outboxId })
      saveFile(`sync-row-${row.key}.json`, text)
    } catch (e) {
      setExportError(errorMessage(e))
    }
  }

  if (!allowed) return <Navigate to="/sell" />

  return (
    <main className="page">
      <div className="actions">
        <button type="button" data-testid="nav-status-back" onClick={() => void navigate({ to: '/status' })}>
          {TH.back}
        </button>
      </div>
      <h1>{TH.syncProblemsTitle}</h1>
      {problems.isError && (
        <p role="alert" className="error">
          {errorMessage(problems.error)}
        </p>
      )}
      {problems.data?.length === 0 && <p>{TH.syncProblemsEmpty}</p>}
      <div className="list">
        {problems.data?.map((row) => (
          <ProblemRow key={row.key} row={row} depth={0} excludeConfirmId={excludeConfirmId} onRemedy={(r, remedy) => setDialog({ row: r, remedy })} onExcludeAsk={setExcludeConfirmId} onExport={(r) => void doExport(r)} />
        ))}
      </div>
      {exportError !== null && (
        <p role="alert" className="error">
          {exportError}
        </p>
      )}
      {dialog !== null && (
        <OwnerApprovalDialog
          title={dialogTitle(dialog.remedy)}
          owners={owners}
          defaultApproverId={user?.role === 'owner' ? user.id : null}
          busy={mutation.isPending}
          error={mutation.isError ? errorMessage(mutation.error) : null}
          submitDisabled={(dialog.remedy === 'REMAP_CODE' && target === null) || (dialog.remedy === 'REMAP_STAFF' && newStaffId === null)}
          extra={
            dialog.remedy === 'REMAP_CODE' ? (
              sellCatalog.data !== undefined ? (
                <RemapCodeFields dto={sellCatalog.data} scope={dialog.row.remap} value={target} onChange={setTarget} />
              ) : (
                <p>{TH.loading}</p>
              )
            ) : dialog.remedy === 'REMAP_STAFF' ? (
              <RemapStaffFields options={staffOptions} value={newStaffId} onChange={setNewStaffId} />
            ) : dialog.remedy === 'EXCLUDE' ? (
              <p role="alert" className="error">
                {dialog.row.reason === 'CLOCK_AHEAD' ? TH.syncExcludeClockAheadWarning : TH.syncExcludeWarning}
              </p>
            ) : undefined
          }
          onSubmit={(approval) => mutation.mutate(approval)}
          onClose={closeDialog}
        />
      )}
    </main>
  )
}
