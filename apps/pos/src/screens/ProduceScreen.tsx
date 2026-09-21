import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState, type JSX } from 'react'
import { scaleQtyMilli } from '@dayo/domain'
import type { ProductionBatchDto, StockItemDto } from '../api/types'
import { useApi } from '../app/api-context'
import { bootstrapKey, stockKey } from '../app/queries'
import { useSession } from '../app/session'
import { errorMessage } from '../ui/errors'
import { formatBaht, formatQty, parseQtyInput } from '../ui/format'
import { TH } from '../ui/th'
import { expiryText } from './StockScreen'

const DATE_TIME = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' })
/** Preset batch sizes: ½, 1, 1½, 2 (spec §5 "ใส่ตัวคูณ"). */
const SCALES_BP = [5_000, 10_000, 15_000, 20_000] as const

/** milli-units → the text a person would type ("1500", "16.6"). */
function qtyText(milli: number): string {
  return formatQty(milli, '').trim().replaceAll(',', '')
}

/**
 * ทำเบส (spec §5 · D17): choose a base → batch size → the components it takes (from the BOM) → actual yield (default =
 * standard) → save. Shows the leftover of the base first and offers to throw it out when expired (Q4-9).
 */
export function ProduceScreen(): JSX.Element {
  const api = useApi()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useSession()
  const stock = useQuery({ queryKey: stockKey, queryFn: () => api.stockOverview() })
  const [baseId, setBaseId] = useState<string | null>(null)
  const [scaleBp, setScaleBp] = useState<number>(10_000)
  const [scaleText, setScaleText] = useState('')
  const [yieldText, setYieldText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<ProductionBatchDto | null>(null)

  const refresh = (): Promise<unknown> => Promise.all([queryClient.invalidateQueries({ queryKey: stockKey }), queryClient.invalidateQueries({ queryKey: bootstrapKey })])
  const save = useMutation({
    mutationFn: (input: { itemId: string; scaleBp: number; yieldActualMilli: number }) => api.produceBatch({ actorUserId: user?.id ?? '', ...input }),
    onSuccess: async (b) => {
      setDone(b)
      setBaseId(null)
      await refresh()
    },
    onError: (e) => setError(errorMessage(e)),
  })
  const discard = useMutation({
    mutationFn: (itemId: string) => api.discardBase({ actorUserId: user?.id ?? '', itemId }),
    onSuccess: refresh,
    onError: (e) => setError(errorMessage(e)),
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
  // review I-2 (controller ruling, Task 9 fix round 1): an inactive base can still hold stock and stay on the stock
  // page (M-11), but producing more of it must be refused — offer active bases only, same as ReceiveScreen's items.
  const bases = stock.data.items.filter((i): i is StockItemDto & { bom: NonNullable<StockItemDto['bom']> } => i.kind === 'prepared' && i.bom !== null && i.isActive)
  const base = bases.find((b) => b.itemId === baseId) ?? null

  const choose = (b: StockItemDto & { bom: NonNullable<StockItemDto['bom']> }, bp: number): void => {
    setBaseId(b.itemId)
    setScaleBp(bp)
    setYieldText(qtyText(scaleQtyMilli(b.bom.yieldMilli, bp)))
    setError(null)
    setDone(null)
  }
  const setScale = (bp: number): void => {
    if (base !== null) choose(base, bp)
  }
  const onScaleText = (text: string): void => {
    setScaleText(text)
    const milli = parseQtyInput(text)
    if (milli !== null && milli > 0) setScale(milli * 10) // 1.5 batches = 1,500 milli = 15,000 bp
  }
  const submit = (): void => {
    if (base === null) return setError(TH.errChooseItem)
    const yieldMilli = parseQtyInput(yieldText)
    if (yieldMilli === null || yieldMilli <= 0) return setError(TH.errQtyFormat)
    setError(null)
    save.mutate({ itemId: base.itemId, scaleBp, yieldActualMilli: yieldMilli })
  }

  return (
    <main className="page">
      <div className="actions">
        <button type="button" data-testid="nav-stock" onClick={() => void navigate({ to: '/stock' })}>
          {TH.back}
        </button>
      </div>
      <h1>{TH.produceTitle}</h1>
      {done !== null && (
        <p className="badge" data-testid="produce-done">
          {TH.produceDone(done.name, formatBaht(done.batchCostSatang), done.expiresAt === null ? TH.stockNoExpiry : `${TH.stockExpiry.fresh} ${DATE_TIME.format(new Date(done.expiresAt))}`)}
        </p>
      )}
      <h2>{TH.produceChooseBase}</h2>
      <div className="choices">
        {bases.map((b) => (
          <button key={b.itemId} type="button" data-testid={`produce-base-${b.code}`} aria-pressed={b.itemId === baseId} onClick={() => choose(b, 10_000)}>
            {b.name}
          </button>
        ))}
      </div>
      {base !== null && (
        <>
          {base.onHandMilli > 0 && (
            <p className={base.latestBatch?.expiry === 'expired' ? 'error' : 'badge'} data-testid="produce-leftover">
              {TH.produceLeftover(formatQty(base.onHandMilli, base.useUnit), expiryText(base) ?? '')}{' '}
              {base.latestBatch?.expiry === 'expired' && (
                <button type="button" data-testid="produce-discard-first" disabled={discard.isPending} onClick={() => discard.mutate(base.itemId)}>
                  {TH.produceDiscardFirst}
                </button>
              )}
            </p>
          )}
          <h2>{TH.produceScale}</h2>
          <div className="choices">
            {SCALES_BP.map((bp) => (
              <button
                key={bp}
                type="button"
                data-testid={`produce-scale-${bp}`}
                aria-pressed={scaleBp === bp}
                onClick={() => {
                  setScaleText('') // M-10: a preset replaces whatever was typed
                  setScale(bp)
                }}
              >
                × {qtyText(bp / 10)}
              </button>
            ))}
            <label>
              {TH.produceScaleCustom}
              <input data-testid="produce-scale" inputMode="decimal" value={scaleText} onChange={(e) => onScaleText(e.target.value)} />
            </label>
          </div>
          <h2>{TH.produceComponents}</h2>
          <ul className="list">
            {base.bom.lines.map((l) => (
              <li key={l.itemId} data-testid={`produce-component-${l.code}`}>
                {l.name} · {formatQty(scaleQtyMilli(l.qtyMilli, scaleBp), l.useUnit)}
              </li>
            ))}
          </ul>
          <label>
            {TH.produceYield(base.useUnit)}
            <input data-testid="produce-yield" inputMode="decimal" value={yieldText} onChange={(e) => setYieldText(e.target.value)} />
          </label>
          {error !== null && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="actions">
            <button type="button" className="primary" data-testid="produce-save" disabled={save.isPending} onClick={submit}>
              {TH.produceSave}
            </button>
          </div>
        </>
      )}
    </main>
  )
}
