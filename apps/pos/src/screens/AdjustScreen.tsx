import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState, type JSX } from 'react'
import type { AdjustReason } from '@dayo/contracts'
import { REASON_MAX_LENGTH, type AdjustDrinkInput, type AdjustItemInput, type StockAdjustmentDto } from '../api/types'
import { useApi } from '../app/api-context'
import { bootstrapKey, menuKey, stockKey } from '../app/queries'
import { useSession } from '../app/session'
import { errorMessage } from '../ui/errors'
import { formatQty, parseQtyInput } from '../ui/format'
import { TH } from '../ui/th'

const REASONS: AdjustReason[] = ['WASTE', 'EXPIRED', 'TRIAL', 'GIVEAWAY', 'OTHER']
type ItemLine = AdjustItemInput & { label: string }
type DrinkLine = AdjustDrinkInput & { label: string }

/**
 * ปรับสต็อก (spec §5 · D50 Q3-20 · Q4-8): stock out with a reason code and a reason — by item (in a purchase unit or
 * the use unit) or by whole drinks through their recipe (แจก/ชดเชย, ทดลองสูตร, ทำผิด). Everyone signed in.
 *
 * The item picker uses `stock.data.items` exactly as `stockOverview` returns it — active items plus an inactive
 * item whose on-hand is not exactly 0 (controller ruling, `requireStockItem`'s `allowInactiveWithStock`, mirrored by
 * `stockCountableItems`). Adding any extra `isActive` filter here would silently hide an inactive item that still
 * holds stock, which the API accepts. Likewise the drink picker uses `menu.data.products`/`variants` exactly as
 * `loadMenu` returns them — that call already filters to active products and variants (M-11), so a drink line can
 * never name one the API would refuse.
 */
export function AdjustScreen(): JSX.Element {
  const api = useApi()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useSession()
  const stock = useQuery({ queryKey: stockKey, queryFn: () => api.stockOverview() })
  const menu = useQuery({ queryKey: menuKey, queryFn: () => api.loadMenu() })
  const [code, setCode] = useState<AdjustReason | null>(null)
  const [mode, setMode] = useState<'items' | 'drinks'>('items')
  const [itemLines, setItemLines] = useState<ItemLine[]>([])
  const [drinkLines, setDrinkLines] = useState<DrinkLine[]>([])
  const [itemCode, setItemCode] = useState('')
  const [unitId, setUnitId] = useState('')
  const [qtyText, setQtyText] = useState('')
  const [productCode, setProductCode] = useState('')
  const [sizeId, setSizeId] = useState('')
  const [sweetnessId, setSweetnessId] = useState('')
  const [drinkQtyText, setDrinkQtyText] = useState('1')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<StockAdjustmentDto | null>(null)

  const save = useMutation({
    mutationFn: (reasonCode: AdjustReason) =>
      api.adjustStock({
        actorUserId: user?.id ?? '',
        reasonCode,
        reason,
        items: itemLines.map((l) => ({ itemId: l.itemId, purchaseUnitId: l.purchaseUnitId, qtyUnitsMilli: l.qtyUnitsMilli })),
        drinks: drinkLines.map((l) => ({ variantId: l.variantId, sweetnessId: l.sweetnessId, qty: l.qty })),
      }),
    onSuccess: async (a) => {
      setDone(a)
      setItemLines([])
      setDrinkLines([])
      setReason('')
      setCode(null)
      await Promise.all([queryClient.invalidateQueries({ queryKey: stockKey }), queryClient.invalidateQueries({ queryKey: bootstrapKey })])
    },
    onError: (e) => setError(errorMessage(e)),
  })

  const failed = stock.error ?? menu.error
  if (failed !== null) {
    return (
      <main className="page">
        <p role="alert" className="error">
          {errorMessage(failed)}
        </p>
      </main>
    )
  }
  if (stock.data === undefined || menu.data === undefined) return <main className="page">{TH.loading}</main>
  const items = stock.data.items
  const item = items.find((i) => i.code === itemCode) ?? null
  const m = menu.data

  const addItem = (): void => {
    if (item === null) return setError(TH.errChooseItem)
    const qty = parseQtyInput(qtyText)
    if (qty === null || qty <= 0) return setError(TH.errQtyFormat)
    const unit = item.units.find((u) => u.id === unitId)
    setItemLines([...itemLines, { itemId: item.itemId, purchaseUnitId: unit?.id ?? null, qtyUnitsMilli: qty, label: `${item.name} · ${formatQty(qty, unit?.name ?? item.useUnit)}` }])
    setItemCode('')
    setUnitId('')
    setQtyText('')
    setError(null)
    setDone(null)
  }
  const addDrink = (): void => {
    const product = m.products.find((p) => p.code === productCode)
    const variant = m.variants.find((v) => v.productId === product?.id && v.sizeId === (sizeId || m.defaultSizeId))
    const sweet = sweetnessId || m.defaultSweetnessId
    const qty = Number(drinkQtyText)
    if (variant === undefined) return setError(TH.errChooseItem)
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) return setError(TH.errQtyFormat)
    const size = m.sizes.find((z) => z.id === variant.sizeId)
    const sweetName = m.sweetness.find((x) => x.id === sweet)?.name ?? ''
    setDrinkLines([...drinkLines, { variantId: variant.id, sweetnessId: sweet, qty, label: `${product?.nameTh ?? ''} ${size?.name ?? ''} ${TH.sweetShort} ${sweetName} × ${qty}` }])
    setProductCode('')
    setDrinkQtyText('1')
    setError(null)
    setDone(null)
  }
  const submit = (): void => {
    if (code === null) return setError(TH.errChooseReason)
    if (itemLines.length + drinkLines.length === 0) return setError(TH.errNothingToAdjust)
    if (reason.trim() === '') return setError(TH.errReasonRequired)
    setError(null)
    save.mutate(code)
  }

  return (
    <main className="page">
      <div className="actions">
        <button type="button" data-testid="nav-stock" onClick={() => void navigate({ to: '/stock' })}>
          {TH.back}
        </button>
      </div>
      <h1>{TH.adjustTitle}</h1>
      {done !== null && (
        <p className="badge" data-testid="adjust-done">
          {TH.adjustDone(done.movements.length)}
        </p>
      )}
      <div className="choices">
        {REASONS.map((r) => (
          <button key={r} type="button" data-testid={`adjust-reason-${r}`} aria-pressed={code === r} onClick={() => setCode(r)}>
            {TH.adjustReasons[r]}
          </button>
        ))}
      </div>
      <div className="choices">
        <button type="button" data-testid="adjust-mode-items" aria-pressed={mode === 'items'} onClick={() => setMode('items')}>
          {TH.adjustModeItems}
        </button>
        <button type="button" data-testid="adjust-mode-drinks" aria-pressed={mode === 'drinks'} onClick={() => setMode('drinks')}>
          {TH.adjustModeDrinks}
        </button>
      </div>
      {mode === 'items' ? (
        <fieldset className="list">
          <label>
            {TH.receiveItem}
            <select
              data-testid="adjust-item"
              value={itemCode}
              onChange={(e) => {
                setItemCode(e.target.value)
                setUnitId('') // the use unit first: most stock-outs are a few g / ml
              }}
            >
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
            <select data-testid="adjust-unit" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
              <option value="">{TH.useUnitOption(item?.useUnit ?? '')}</option>
              {item?.units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({formatQty(u.qtyPerUnitMilli, item.useUnit)})
                </option>
              ))}
            </select>
          </label>
          <label>
            {TH.receiveQty}
            <input data-testid="adjust-qty" inputMode="decimal" value={qtyText} onChange={(e) => setQtyText(e.target.value)} />
          </label>
          <button type="button" data-testid="adjust-add-item" onClick={addItem}>
            {TH.adjustAdd}
          </button>
        </fieldset>
      ) : (
        <fieldset className="list">
          <label>
            {TH.adjustProduct}
            <select data-testid="adjust-product" value={productCode} onChange={(e) => setProductCode(e.target.value)}>
              <option value="">—</option>
              {m.products.map((p) => (
                <option key={p.id} value={p.code}>
                  {p.nameTh}
                </option>
              ))}
            </select>
          </label>
          <label>
            {TH.size}
            <select data-testid="adjust-size" value={sizeId || m.defaultSizeId} onChange={(e) => setSizeId(e.target.value)}>
              {m.sizes.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {TH.sweetness}
            <select data-testid="adjust-sweet" value={sweetnessId || m.defaultSweetnessId} onChange={(e) => setSweetnessId(e.target.value)}>
              {m.sweetness.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {TH.adjustDrinkQty}
            <input data-testid="adjust-drink-qty" inputMode="numeric" value={drinkQtyText} onChange={(e) => setDrinkQtyText(e.target.value)} />
          </label>
          <button type="button" data-testid="adjust-add-drink" onClick={addDrink}>
            {TH.adjustAdd}
          </button>
        </fieldset>
      )}
      <ul className="list">
        {itemLines.map((l, i) => (
          <li key={`i-${i}`} data-testid={`adjust-line-item-${i}`}>
            {l.label}{' '}
            <button type="button" onClick={() => setItemLines(itemLines.filter((_, j) => j !== i))}>
              {TH.remove}
            </button>
          </li>
        ))}
        {drinkLines.map((l, i) => (
          <li key={`d-${i}`} data-testid={`adjust-line-drink-${i}`}>
            {l.label}{' '}
            <button type="button" onClick={() => setDrinkLines(drinkLines.filter((_, j) => j !== i))}>
              {TH.remove}
            </button>
          </li>
        ))}
      </ul>
      <label>
        {TH.adjustReason}
        <input data-testid="adjust-reason" maxLength={REASON_MAX_LENGTH} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="button" className="primary" data-testid="adjust-save" disabled={save.isPending} onClick={submit}>
          {TH.adjustSave}
        </button>
      </div>
    </main>
  )
}
