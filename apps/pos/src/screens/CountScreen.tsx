import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState, type JSX } from 'react'
import { unitsToUseMilli } from '@dayo/domain'
import { MAX_UNITS_MILLI } from '../api/stock-common'
import type { StockCountDto, StockCountLineDto, StockItemDto } from '../api/types'
import { useApi } from '../app/api-context'
import { bootstrapKey, stockCountKey, stockKey } from '../app/queries'
import { useSession } from '../app/session'
import { errorMessage } from '../ui/errors'
import { formatBaht, formatQty, parseCountInput, parseQtyInput } from '../ui/format'
import { TH } from '../ui/th'

/**
 * Q4-14 · spec §5 "หน่วยซื้อ + เศษ": whole purchase units + the loose rest in the use unit (3 ถุง + 120 g) → use-unit
 * milli, the only form sent to the API (purchaseUnitId null). Blank fields are 0 · null when a field is not a number.
 * Whether an all-blank pair is refused is decided by the caller (CountRow.save) — this stays a pure converter.
 */
export function countedUseMilli(unitsText: string, restText: string, qtyPerUnitMilli: number | null): number | null {
  const units = parseCountInput(unitsText)
  const rest = restText.trim() === '' ? 0 : parseQtyInput(restText)
  if (units === null || rest === null) return null
  return (qtyPerUnitMilli === null ? 0 : unitsToUseMilli(units * 1_000, qtyPerUnitMilli)) + rest
}

/** milli of the use unit → the same decimal text `parseQtyInput` would parse back to it (no thousands separators). */
function milliToText(milli: number): string {
  const whole = Math.floor(milli / 1000)
  const frac = String(milli % 1000).padStart(3, '0').replace(/0+$/, '')
  return frac === '' ? String(whole) : `${whole}.${frac}`
}

/**
 * Review I-2 (controller ruling, Task 12 fix round 1): the inverse of `countedUseMilli`, floor/mod, so "แก้ตัวเลข"
 * can reopen pre-filled with the line's own already-saved counted value — never the book figure, which stays
 * invisible. Showing the person's own number back to them does not weaken the blind count (Q4-3): the book figure
 * and the variance are not involved, and both are already on screen once a line is saved.
 */
export function splitCountedUseMilli(countedUseMilliValue: number, qtyPerUnitMilli: number | null): { unitsText: string; restText: string } {
  if (qtyPerUnitMilli === null) return { unitsText: '', restText: milliToText(countedUseMilliValue) }
  const units = Math.floor(countedUseMilliValue / qtyPerUnitMilli)
  const rest = countedUseMilliValue % qtyPerUnitMilli
  return { unitsText: String(units), restText: milliToText(rest) }
}

/**
 * One item row: blind until saved (Q4-3) — nothing about the book figure or the variance is rendered, in text or in
 * any attribute (including `value`, `placeholder` and `data-*`), before this line has a saved result. Once saved it
 * shows counted / variance / "ยอดยกมาครั้งแรก" and offers two different paths (review m-2 · I-2, Task 7 · 12):
 *   - "แก้ตัวเลข" ("count-recount-<code>") — a TYPO FIX ONLY. Reopens the inputs pre-filled from this line's own
 *     saved counted value (never the book figure), so an accidental tap does not blank a good count; "ยกเลิก" backs
 *     out untouched. The book figure this line is compared against stays exactly as it was frozen on the first save.
 *   - "ไม่นับรายการนี้" ("count-remove-<code>") — the real recount path after sales moved the shelf: it drops the
 *     draft line entirely, so the very next save on this item freezes the book figure fresh, against the live stock.
 * The hint text and the `title` tooltips on both buttons say this in Thai — the button labels alone read as near
 * synonyms ("fix the number" vs. "don't count this"), so a person must be told which one re-freezes the figure.
 */
function CountRow({
  item,
  line,
  busy,
  onSave,
  onRemove,
}: {
  item: StockItemDto
  line: StockCountLineDto | undefined
  busy: boolean
  onSave: (useMilli: number) => Promise<void>
  onRemove: () => void
}): JSX.Element {
  const unit = item.units.find((u) => u.isDefault) ?? item.units[0] ?? null
  const [unitsText, setUnitsText] = useState('')
  const [restText, setRestText] = useState('')
  const [editing, setEditing] = useState(line === undefined)
  const [error, setError] = useState<string | null>(null)

  const openEdit = (): void => {
    if (line !== undefined) {
      const split = splitCountedUseMilli(line.countedUseMilli, unit?.qtyPerUnitMilli ?? null)
      setUnitsText(split.unitsText)
      setRestText(split.restText)
    }
    setError(null)
    setEditing(true)
  }
  // review I-2: leaves the saved line exactly as it was — no save, no remove, just back to the display view.
  const cancelEdit = (): void => {
    setUnitsText('')
    setRestText('')
    setError(null)
    setEditing(false)
  }

  const save = async (): Promise<void> => {
    // review I-2 (controller ruling): a blank pair is refused, never silently saved as 0 — an accidental tap on
    // "บันทึก" (for example right after "แก้ตัวเลข") cannot zero out a good count. An explicit "0" is still allowed.
    const blank = restText.trim() === '' && (unit === null || unitsText.trim() === '')
    if (blank) return setError(TH.errCountBlank)
    const milli = countedUseMilli(unitsText, restText, unit?.qtyPerUnitMilli ?? null)
    if (milli === null) return setError(TH.errQtyFormat)
    // review m-6: the same MAX_UNITS_MILLI cap the server enforces (assertUnitsMilli), checked here first so a
    // typo'd huge count neither round-trips to the server nor loses what was typed to a generic BAD_INPUT detail.
    if (milli > MAX_UNITS_MILLI) return setError(TH.errCountTooLarge(formatQty(MAX_UNITS_MILLI, item.useUnit)))
    setError(null)
    // review m-1: edit mode and the typed inputs are cleared only once the save actually succeeds — a refusal or a
    // network failure leaves exactly what was typed, with the reason in this row's own alert.
    try {
      await onSave(milli)
      setEditing(false)
      setUnitsText('')
      setRestText('')
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <li className="list" data-testid={`count-row-${item.code}`}>
      <strong>
        {item.name} <small className="badge">{item.code}</small>
      </strong>
      {line !== undefined && !editing ? (
        <span>
          <span data-testid={`count-counted-${item.code}`}>{TH.countCounted(formatQty(line.countedUseMilli, line.useUnit))}</span> ·{' '}
          <span className={line.varianceUseMilli === 0 ? 'badge' : 'error'} data-testid={`count-variance-${item.code}`}>
            {TH.countVariance(formatQty(line.varianceUseMilli, line.useUnit), formatBaht(line.varianceSatang))}
          </span>
          {line.opening && (
            <span className="badge" data-testid={`count-opening-${item.code}`}>
              {' '}
              · {TH.countOpening}
            </span>
          )}{' '}
          <button type="button" data-testid={`count-recount-${item.code}`} title={TH.countRecountHint} disabled={busy} onClick={openEdit}>
            {TH.countRecount}
          </button>
          <button type="button" data-testid={`count-remove-${item.code}`} title={TH.countRecountHint} disabled={busy} onClick={onRemove}>
            {TH.countSkip}
          </button>
          <br />
          <small className="badge">{TH.countRecountHint}</small>
        </span>
      ) : (
        <span className="choices">
          {unit !== null && (
            <label>
              {TH.countUnits(unit.name, formatQty(unit.qtyPerUnitMilli, item.useUnit))}
              <input data-testid={`count-units-${item.code}`} inputMode="numeric" value={unitsText} onChange={(e) => setUnitsText(e.target.value)} />
            </label>
          )}
          <label>
            {TH.countRest(item.useUnit)}
            <input data-testid={`count-rest-${item.code}`} inputMode="decimal" value={restText} onChange={(e) => setRestText(e.target.value)} />
          </label>
          <button type="button" data-testid={`count-save-${item.code}`} disabled={busy} onClick={() => void save()}>
            {TH.countSaveLine}
          </button>
          {line !== undefined && (
            <button type="button" data-testid={`count-cancel-${item.code}`} disabled={busy} onClick={cancelEdit}>
              {TH.cancel}
            </button>
          )}
        </span>
      )}
      {error !== null && (
        <span role="alert" className="error">
          {error}
        </span>
      )}
    </li>
  )
}

/**
 * นับสต็อก (spec §4.5 · §5): one open count per device, resumed after a lock or reload. Count what is on the shelf as
 * whole purchase units + the loose rest (Q4-14), item by item — the book figure and the variance show only after a
 * line is saved (Q4-3). The first count is the opening count: all items, no scope choice (Q4-13 · D30). "ปิดใบนับ"
 * writes COUNT_ADJ / OPENING for every counted line. Everyone signed in.
 */
export function CountScreen(): JSX.Element {
  const api = useApi()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useSession()
  const actorUserId = user?.id ?? ''
  const stock = useQuery({ queryKey: stockKey, queryFn: () => api.stockOverview() })
  const count = useQuery({ queryKey: stockCountKey, queryFn: () => api.getOpenStockCount() })
  const [scope, setScope] = useState<'key' | 'all'>('key')
  const [confirming, setConfirming] = useState(false)
  const [closed, setClosed] = useState<StockCountDto | null>(null)
  const [error, setError] = useState<string | null>(null)

  const setCount = (c: StockCountDto | null): void => {
    queryClient.setQueryData(stockCountKey, c)
  }
  const onError = (e: unknown): void => setError(errorMessage(e))
  const start = useMutation({
    mutationFn: () => api.startStockCount(actorUserId),
    onSuccess: async (c) => {
      setCount(c)
      setClosed(null) // m-8: a fresh count is not the last one's closed summary
      setError(null) // I-3: a new count starting successfully clears any stale banner
      await queryClient.invalidateQueries({ queryKey: stockKey }) // m-5: nav-count's "ต่อ" label follows immediately
    },
    onError,
  })
  const saveLine = useMutation({
    mutationFn: (v: { countId: string; itemId: string; countedUnitsMilli: number }) => api.saveCountLine({ actorUserId, purchaseUnitId: null, ...v }),
    onSuccess: (c) => {
      setCount(c)
      setError(null) // I-3
    },
    onError,
  })
  const removeLine = useMutation({
    mutationFn: (v: { countId: string; itemId: string }) => api.removeCountLine({ actorUserId, ...v }),
    onSuccess: (c) => {
      setCount(c)
      setError(null) // I-3
    },
    onError,
  })
  const close = useMutation({
    mutationFn: (countId: string) => api.closeStockCount({ actorUserId, countId }),
    onSuccess: async (c) => {
      setClosed(c)
      setConfirming(false)
      setCount(null)
      setError(null) // I-3
      await Promise.all([queryClient.invalidateQueries({ queryKey: stockKey }), queryClient.invalidateQueries({ queryKey: bootstrapKey })])
    },
    onError: (e) => {
      setConfirming(false) // m-2: a refusal (e.g. OPENING_COUNT_INCOMPLETE) un-arms the confirm — ask again to retry
      onError(e)
    },
  })
  // review: save/close disabled together while any of these is in flight — one shared flag, so a double tap on any
  // button (including a different row's save) can never fire a second request while the first is still pending.
  const busy = saveLine.isPending || removeLine.isPending || close.isPending

  const failed = stock.error ?? count.error
  if (failed !== null) {
    return (
      <main className="page">
        <p role="alert" className="error">
          {errorMessage(failed)}
        </p>
      </main>
    )
  }
  if (stock.data === undefined || count.data === undefined) return <main className="page">{TH.loading}</main>
  const open = count.data
  const opening = stock.data.openingCountPending // Q4-13: the opening count covers every item
  // m-4: a saved line is shown regardless of scope — a weekly count taken in "ทั้งหมด" and resumed after a lock must
  // not hide its own non-key lines behind the "ชุดหลัก" default, where they could not be reviewed or removed.
  const items = stock.data.items.filter((i) => opening || scope === 'all' || i.isKeyCount || (open?.lines.some((l) => l.itemId === i.itemId) ?? false))

  return (
    <main className="page">
      <div className="actions">
        <button type="button" data-testid="nav-stock" onClick={() => void navigate({ to: '/stock' })}>
          {TH.back}
        </button>
      </div>
      <h1>{TH.countTitle}</h1>
      {closed !== null && (
        <p className="badge" data-testid="count-closed">
          {TH.countClosed(closed.lines.filter((l) => l.varianceUseMilli !== 0).length, formatBaht(closed.totalVarianceSatang))}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {open === null ? (
        <button type="button" className="primary" data-testid="count-start" disabled={start.isPending} onClick={() => start.mutate()}>
          {TH.countStart}
        </button>
      ) : (
        <>
          <p className="badge">{TH.countBlindHint}</p>
          {opening ? (
            <p className="badge" data-testid="count-opening-hint">
              {TH.countOpeningHint}
            </p>
          ) : (
            <div className="choices">
              <button type="button" data-testid="count-scope-key" aria-pressed={scope === 'key'} onClick={() => setScope('key')}>
                {TH.countScopeKey}
              </button>
              <button type="button" data-testid="count-scope-all" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>
                {TH.countScopeAll}
              </button>
            </div>
          )}
          <ul className="list">
            {items.map((i) => (
              <CountRow
                key={i.itemId}
                item={i}
                line={open.lines.find((l) => l.itemId === i.itemId)}
                busy={busy}
                onSave={async (countedUnitsMilli) => {
                  await saveLine.mutateAsync({ countId: open.id, itemId: i.itemId, countedUnitsMilli })
                }}
                onRemove={() => removeLine.mutate({ countId: open.id, itemId: i.itemId })}
              />
            ))}
          </ul>
          <p>
            {TH.countLines(open.lines.length)} · {TH.countTotalVariance} <strong data-testid="count-total-variance">{formatBaht(open.totalVarianceSatang)}</strong>
          </p>
          <div className="actions">
            {confirming ? (
              <button type="button" className="primary" data-testid="count-close-confirm" disabled={busy} onClick={() => close.mutate(open.id)}>
                {TH.countCloseConfirm}
              </button>
            ) : (
              <button type="button" data-testid="count-close" disabled={busy} onClick={() => setConfirming(true)}>
                {TH.countClose}
              </button>
            )}
          </div>
        </>
      )}
    </main>
  )
}
