import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState, type JSX } from 'react'
import { isPriceJump, priceDeviationBp, purchaseUnitCostUsat, unitsToUseMilli } from '@dayo/domain'
import { posErrorCode } from '../api/errors'
import { REASON_MAX_LENGTH, type PurchaseDto, type PurchaseLineInput, type StockItemDto } from '../api/types'
import { useApi } from '../app/api-context'
import { bootstrapKey, shiftReportKey, stockKey, useBootstrap } from '../app/queries'
import { useSession } from '../app/session'
import { useDrawerCheck } from '../app/use-drawer-check'
import { errorMessage } from '../ui/errors'
import { formatBaht, formatQty, parseBahtInput, parseQtyInput } from '../ui/format'
import { TH } from '../ui/th'

type Line = PurchaseLineInput & { item: StockItemDto; unitName: string }

/** "+10.4%" — the deviation of this line's unit cost from the item's last purchase price (or standard cost), when it is a jump (D47 item 3 · Q4-15). */
function jumpText(l: Line): string | null {
  const perUnit = l.purchaseUnitId === null ? 1_000 : (l.item.units.find((u) => u.id === l.purchaseUnitId)?.qtyPerUnitMilli ?? 1_000)
  try {
    const qtyUse = unitsToUseMilli(l.qtyUnitsMilli, perUnit)
    if (qtyUse <= 0) return null
    const cost = purchaseUnitCostUsat(l.lineTotalSatang, qtyUse)
    if (!isPriceJump(cost, l.item.priceCheckUsat)) return null
    const bp = priceDeviationBp(cost, l.item.priceCheckUsat)
    const pct = bp === Number.MAX_SAFE_INTEGER ? '∞' : `${(bp / 100).toFixed(1)}%`
    return `${cost > l.item.priceCheckUsat ? '+' : '−'}${pct}`
  } catch {
    return null // out-of-range numbers: the API refuses them with BAD_INPUT on save
  }
}

/**
 * รับของเข้า (spec §5 · D19): lines of item · purchase unit · quantity · total price, the supplier, and optionally
 * "paid from the drawer" (Q4-6 — with the Q3b-14 over-drawer confirm of a manual paid-out). Tracked raw items only
 * (D29). A price more than 10% off the last purchase price is flagged on the line and, if saved anyway, refused once
 * with PRICE_JUMP until "ยืนยันราคานี้" (D47 item 3 · Q4-15). Receipt photo: plan 5 (Q4-5).
 *
 * `acceptPriceJump` is a single flag for the whole receipt (review m-3, Task 4): it is not stored — only the
 * transient `priceJump` state (whether the API just refused the current lines with PRICE_JUMP) drives the confirm
 * button. Any change to the lines — adding one or removing one — clears `priceJump`, so a receipt edited after a
 * refusal is checked again from scratch rather than letting a stale "ยืนยันราคานี้" press through a since-changed
 * set of lines.
 */
export function ReceiveScreen(): JSX.Element {
  const api = useApi()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useSession()
  const boot = useBootstrap()
  const stock = useQuery({ queryKey: stockKey, queryFn: () => api.stockOverview() })
  const [supplier, setSupplier] = useState('')
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [itemCode, setItemCode] = useState('')
  const [unitId, setUnitId] = useState('')
  const [qtyText, setQtyText] = useState('')
  const [totalText, setTotalText] = useState('')
  const [paidFromDrawer, setPaidFromDrawer] = useState(false)
  const [priceJump, setPriceJump] = useState(false)
  const [overDrawer, setOverDrawer] = useState(false)
  const drawer = useDrawerCheck(paidFromDrawer)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<PurchaseDto | null>(null)

  const save = useMutation({
    mutationFn: (acceptPriceJump: boolean) =>
      api.receivePurchase({
        actorUserId: user?.id ?? '',
        supplier,
        note,
        lines: lines.map((l) => ({ itemId: l.itemId, purchaseUnitId: l.purchaseUnitId, qtyUnitsMilli: l.qtyUnitsMilli, lineTotalSatang: l.lineTotalSatang })),
        paidFromDrawer,
        acceptPriceJump,
      }),
    onSuccess: async (p) => {
      setDone(p)
      setLines([])
      setSupplier('')
      setNote('')
      setPaidFromDrawer(false)
      setPriceJump(false)
      setOverDrawer(false)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: stockKey }),
        queryClient.invalidateQueries({ queryKey: bootstrapKey }),
        queryClient.invalidateQueries({ queryKey: shiftReportKey }),
      ])
    },
    onError: (e) => {
      if (posErrorCode(e) === 'PRICE_JUMP') setPriceJump(true)
      setError(errorMessage(e))
    },
  })

  if (stock.isError) {
    return (
      <main className="page">
        <p role="alert" className="error">
          {errorMessage(stock.error)}
        </p>
      </main>
    )
  }
  if (stock.data === undefined) return <main className="page">{TH.loading}</main>
  const items = stock.data.items.filter((i) => i.kind === 'raw')
  const sumSatang = lines.reduce((a, l) => a + l.lineTotalSatang, 0)
  const submit = (acceptPriceJump: boolean): void => {
    // Q3b-14 · D54 via Q4-6: more than the drawer should hold → one explicit confirm first (no figure shown)
    if (paidFromDrawer && !overDrawer) {
      if (drawer.pending) return
      if (drawer.exceeds(sumSatang)) return setOverDrawer(true)
    }
    save.mutate(acceptPriceJump)
  }
  const item = items.find((i) => i.code === itemCode) ?? null
  const hasShift = boot.data?.openShift != null

  const pickItem = (code: string): void => {
    setItemCode(code)
    const it = items.find((i) => i.code === code)
    setUnitId(it?.units.find((u) => u.isDefault)?.id ?? it?.units[0]?.id ?? '')
  }
  // review m-3 (Task 4 fix round 1, carried into Task 9): editing the lines after a PRICE_JUMP refusal clears
  // `priceJump` (and any over-drawer warning tied to the old total) — the changed receipt is checked from scratch.
  const addLine = (): void => {
    if (item === null) return setError(TH.errChooseItem)
    const qty = parseQtyInput(qtyText)
    const total = parseBahtInput(totalText)
    if (qty === null || qty <= 0) return setError(TH.errQtyFormat)
    if (total === null) return setError(TH.errBadInput)
    const unit = item.units.find((u) => u.id === unitId)
    setLines([...lines, { itemId: item.itemId, purchaseUnitId: unit?.id ?? null, qtyUnitsMilli: qty, lineTotalSatang: total, item, unitName: unit?.name ?? item.useUnit }])
    setItemCode('')
    setUnitId('')
    setQtyText('')
    setTotalText('')
    setPriceJump(false)
    setOverDrawer(false)
    setError(null)
    setDone(null)
  }
  const removeLine = (i: number): void => {
    setLines(lines.filter((_, j) => j !== i))
    setPriceJump(false)
    setOverDrawer(false)
  }

  return (
    <main className="page">
      <div className="actions">
        <button type="button" data-testid="nav-stock" onClick={() => void navigate({ to: '/stock' })}>
          {TH.back}
        </button>
      </div>
      <h1>{TH.receiveTitle}</h1>
      {done !== null && (
        <p className="badge" data-testid="receive-done">
          {TH.receiveDone(formatBaht(done.totalSatang))}
        </p>
      )}
      <label>
        {TH.receiveSupplier}
        <input data-testid="receive-supplier" maxLength={REASON_MAX_LENGTH} value={supplier} onChange={(e) => setSupplier(e.target.value)} />
      </label>
      <fieldset className="list">
        <label>
          {TH.receiveItem}
          <select data-testid="receive-item" value={itemCode} onChange={(e) => pickItem(e.target.value)}>
            <option value="">—</option>
            {items.map((i) => (
              <option key={i.itemId} value={i.code}>
                {i.name} ({i.code})
              </option>
            ))}
          </select>
        </label>
        <label>
          {TH.receiveUnit}
          <select data-testid="receive-unit" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
            {item?.units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({formatQty(u.qtyPerUnitMilli, item.useUnit)})
              </option>
            ))}
            <option value="">{TH.useUnitOption(item?.useUnit ?? '')}</option>
          </select>
        </label>
        <label>
          {TH.receiveQty}
          <input data-testid="receive-qty" inputMode="decimal" value={qtyText} onChange={(e) => setQtyText(e.target.value)} />
        </label>
        <label>
          {TH.receiveLineTotal}
          <input data-testid="receive-total" inputMode="decimal" value={totalText} onChange={(e) => setTotalText(e.target.value)} />
        </label>
        <button type="button" data-testid="receive-add" onClick={addLine}>
          {TH.receiveAdd}
        </button>
      </fieldset>
      <ul className="list">
        {lines.map((l, i) => {
          const jump = jumpText(l)
          return (
            <li key={`${l.itemId}-${i}`} data-testid={`receive-line-${i}`}>
              {l.item.name} · {formatQty(l.qtyUnitsMilli, l.unitName)} · {formatBaht(l.lineTotalSatang)}{' '}
              {jump !== null && (
                <span className="error" data-testid={`receive-jump-${i}`}>
                  {TH.receiveJump(jump)}
                </span>
              )}{' '}
              <button type="button" data-testid={`receive-remove-${i}`} onClick={() => removeLine(i)}>
                {TH.remove}
              </button>
            </li>
          )
        })}
      </ul>
      <p>
        {TH.receiveSum} <strong data-testid="receive-sum">{formatBaht(sumSatang)}</strong>
      </p>
      <label>
        {TH.receiveNote}
        <input data-testid="receive-note" maxLength={REASON_MAX_LENGTH} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <label className="check">
        <input
          type="checkbox"
          data-testid="receive-paid-drawer"
          checked={paidFromDrawer}
          disabled={!hasShift}
          onChange={(e) => {
            setPaidFromDrawer(e.target.checked)
            setOverDrawer(false)
          }}
        />
        {hasShift ? TH.receivePaidDrawer : TH.receivePaidDrawerNoShift}
      </label>
      {error !== null && (
        <p role="alert" className="error" data-testid={priceJump ? 'receive-price-jump' : undefined}>
          {error}
        </p>
      )}
      {overDrawer && (
        <p role="alert" className="error" data-testid="receive-over-drawer-warning">
          {TH.cashOverDrawerWarning}
        </p>
      )}
      <div className="actions">
        {priceJump && (
          <button type="button" data-testid="receive-confirm-price" disabled={save.isPending} onClick={() => submit(true)}>
            {TH.receiveConfirmPrice}
          </button>
        )}
        {overDrawer && (
          <button type="button" data-testid="receive-over-drawer-confirm" disabled={save.isPending} onClick={() => save.mutate(priceJump)}>
            {TH.cashOverDrawerConfirm}
          </button>
        )}
        <button type="button" className="primary" data-testid="receive-save" disabled={save.isPending || lines.length === 0 || (paidFromDrawer && drawer.pending)} onClick={() => submit(false)}>
          {TH.receiveSave}
        </button>
      </div>
    </main>
  )
}
