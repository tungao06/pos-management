import { useMemo, useState, type JSX } from 'react'
import type { MilkCode, Sweetness } from '@dayo/dayo-pricing'
import { CartError, lineOptions, lineUnitPriceSatang, type GradeChoice, type MilkChoice, type PosOrderCatalog } from '@dayo/domain'
import type { SellMenuDto } from '../api/types'
import { useCart } from '../app/cart-context'
import { formatBaht } from '../ui/format'
import { TH } from '../ui/th'

const SWEETNESS_ORDER: readonly Sweetness[] = ['0%', '25%', '50%', '75%', '100%']

type Options = { milk: MilkChoice[]; grades: GradeChoice[]; defaultMilk: MilkCode; defaultGrade: string | null }

/** Popup on every tap, `menu.defaultSize`/`defaultSweetness` preselected (spec §5, ADR-0054 — never a fixed size/
 * sweetness). Options (milk, matcha grade) come from dayo's own `lineOptions`; every price shown (the big amount and
 * every option's "+฿" label) comes from `lineUnitPriceSatang` — the screen never adds milk/grade/channel money itself
 * (review I1). Size/sweetness/milk/grade are all derived state, never `useEffect`, so a render can never see a
 * combo `lineOptions`/`lineUnitPriceSatang` cannot answer (review I2) — a menu or size that vanished from the
 * catalog (a 60 s refetch while the dialog is open) just disables "เพิ่มลงตะกร้า" with a Thai message, never throws. */
export function ItemDialog({
  catalog,
  menu,
  channelCode,
  maxQtyPerLine,
  onClose,
}: {
  catalog: PosOrderCatalog
  menu: SellMenuDto
  channelCode: string
  maxQtyPerLine: number
  onClose: () => void
}): JSX.Element {
  const { dispatch } = useCart()

  // review I2: every field below is derived from the latest props + the cashier's own choice — never `useEffect` —
  // so switching size/sweetness never renders a stale combo before a later effect corrects it.
  const [sizeChoice, setSizeChoice] = useState<string | null>(null)
  const size = sizeChoice !== null && menu.sizes.includes(sizeChoice) ? sizeChoice : menu.sizes.includes(menu.defaultSize) ? menu.defaultSize : (menu.sizes[0] ?? null)
  const sweetChoices = size === null ? [] : menu.sweetnessBySize[size] ?? []
  const [sweetnessChoice, setSweetnessChoice] = useState<Sweetness | null>(null)
  const sweetness = sweetnessChoice !== null && sweetChoices.includes(sweetnessChoice) ? sweetnessChoice : sweetChoices.includes(menu.defaultSweetness) ? menu.defaultSweetness : (sweetChoices[0] ?? null)

  // never throws: a menu/size the catalog no longer sells (vanished after a refetch) just yields `null` here.
  const opts: Options | null = useMemo(() => {
    if (size === null || sweetness === null) return null
    try {
      return lineOptions(catalog, menu.code, size, sweetness)
    } catch (e) {
      if (e instanceof CartError) return null
      throw e
    }
  }, [catalog, menu.code, size, sweetness])

  const [milkChoice, setMilkChoice] = useState<MilkCode | null>(null)
  const milk: MilkCode = milkChoice !== null && opts !== null && opts.milk.some((m) => m.code === milkChoice) ? milkChoice : (opts?.defaultMilk ?? 'fresh')
  const [gradeChoice, setGradeChoice] = useState<string | null>(null)
  const grade = menu.isMatcha && opts !== null ? (gradeChoice !== null && opts.grades.some((g) => g.code === gradeChoice) ? gradeChoice : opts.defaultGrade) : null

  /** The only place this dialog ever prices anything (review I1) — always dayo's own `channelPrice(price + priceAdd)`. */
  const priceOf = (m: MilkCode, g: string | null): number | null => (size === null || sweetness === null ? null : lineUnitPriceSatang(catalog, menu.code, size, sweetness, m, g, channelCode))
  const price = priceOf(milk, grade)
  const gone = size === null || sweetness === null || opts === null // the menu or every size/sweetness of it is gone
  const freshPrice = opts === null ? null : priceOf('fresh', grade)
  const defaultGradePrice = opts === null || opts.defaultGrade === null ? null : priceOf(milk, opts.defaultGrade)

  const add = (): void => {
    if (gone || price === null || size === null || sweetness === null) return
    dispatch({ type: 'add', line: { code: menu.code, nameTh: menu.nameTh, size, sweetness, milk, grade }, maxQty: maxQtyPerLine })
    onClose()
  }

  return (
    <div className="dialog-backdrop" role="dialog" aria-label={menu.nameTh}>
      <div className="dialog">
        <h2>{menu.nameTh}</h2>
        <h3>{TH.size}</h3>
        <div className="choices">
          {menu.sizes.map((z) => {
            const label = catalog.sizes.find((s) => s.code === z)?.label ?? z
            return (
              <button key={z} type="button" data-testid={`item-size-${z.replace(/\s+/g, '').toLowerCase()}`} aria-pressed={z === size} onClick={() => setSizeChoice(z)}>
                {label}
              </button>
            )
          })}
        </div>
        <h3>{TH.sweetness}</h3>
        <div className="choices">
          {SWEETNESS_ORDER.filter((w) => sweetChoices.includes(w)).map((w) => (
            <button key={w} type="button" data-testid={`item-sweet-${w}`} aria-pressed={w === sweetness} onClick={() => setSweetnessChoice(w)}>
              {w}
            </button>
          ))}
        </div>
        {opts !== null && (
          <>
            <h3>{TH.milk}</h3>
            <div className="choices">
              {opts.milk.map((m) => {
                const p = priceOf(m.code, grade)
                const add2 = p !== null && freshPrice !== null ? p - freshPrice : 0
                return (
                  <button key={m.code} type="button" data-testid={`item-milk-${m.code}`} aria-pressed={m.code === milk} onClick={() => setMilkChoice(m.code)}>
                    {m.code === 'oat' ? TH.milkOat : TH.milkFresh}
                    {add2 > 0 && ` +${formatBaht(add2)}`}
                  </button>
                )
              })}
            </div>
          </>
        )}
        {menu.isMatcha && opts !== null && (
          <>
            <h3>{TH.grade}</h3>
            <div className="choices">
              {opts.grades.map((g) => {
                const p = priceOf(milk, g.code)
                const add2 = p !== null && defaultGradePrice !== null ? p - defaultGradePrice : 0
                return (
                  <button key={g.code} type="button" data-testid={`item-grade-${g.code}`} aria-pressed={g.code === grade} onClick={() => setGradeChoice(g.code)}>
                    {g.code}
                    {add2 > 0 && ` +${formatBaht(add2)}`}
                  </button>
                )
              })}
            </div>
          </>
        )}
        {gone && (
          <p role="alert" className="error" data-testid="item-unavailable">
            {TH.itemUnavailable}
          </p>
        )}
        <div className="big-amount">{price === null ? TH.noPrice : formatBaht(price)}</div>
        <div className="actions">
          <button type="button" data-testid="item-cancel" onClick={onClose}>
            {TH.cancel}
          </button>
          <button type="button" className="primary" data-testid="item-add" disabled={gone || price === null} onClick={add}>
            {TH.addToCart}
          </button>
        </div>
      </div>
    </div>
  )
}
