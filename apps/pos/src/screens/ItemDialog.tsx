import { useEffect, useState, type JSX } from 'react'
import type { MilkCode, Sweetness } from '@dayo/dayo-pricing'
import { lineOptions, menuUnitPriceSatang, type PosOrderCatalog } from '@dayo/domain'
import type { SellMenuDto } from '../api/types'
import { useCart } from '../app/cart-context'
import { formatBaht } from '../ui/format'
import { TH } from '../ui/th'

const SWEETNESS_ORDER: readonly Sweetness[] = ['0%', '25%', '50%', '75%', '100%']

/** Popup on every tap, `menu.defaultSize`/`defaultSweetness` preselected (spec §5, ADR-0054 — never a fixed
 * '16 oz'/50%). Options (milk, matcha grade) come from dayo's own `lineOptions` for the exact size+sweetness picked. */
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
  const [size, setSize] = useState<string>(menu.defaultSize)
  const sweetChoices = menu.sweetnessBySize[size] ?? []
  const [sweetness, setSweetness] = useState<Sweetness>(menu.defaultSweetness)
  useEffect(() => {
    if (!sweetChoices.includes(sweetness)) setSweetness(sweetChoices[0] ?? menu.defaultSweetness)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size])

  const opts = lineOptions(catalog, menu.code, size, sweetness)
  const [milk, setMilk] = useState<MilkCode>(opts.defaultMilk)
  const [grade, setGrade] = useState<string | null>(opts.defaultGrade)
  useEffect(() => {
    if (!opts.milk.some((m) => m.code === milk)) setMilk(opts.defaultMilk)
    if (menu.isMatcha && !opts.grades.some((g) => g.code === grade)) setGrade(opts.defaultGrade)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, sweetness])

  const variant = catalog.variants.find((v) => v.menuCode === menu.code && v.size === size && v.sweetness === sweetness)
  const basePrice = variant === undefined ? null : menuUnitPriceSatang(catalog, variant, channelCode)
  const milkAdd = opts.milk.find((m) => m.code === milk)?.priceAddSatang ?? 0
  const gradeAdd = menu.isMatcha ? (opts.grades.find((g) => g.code === grade)?.priceAddSatang ?? 0) : 0
  const price = basePrice === null ? null : basePrice + milkAdd + gradeAdd

  const add = (): void => {
    if (price === null) return
    dispatch({ type: 'add', line: { code: menu.code, nameTh: menu.nameTh, size, sweetness, milk, grade: menu.isMatcha ? grade : null }, maxQty: maxQtyPerLine })
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
              <button key={z} type="button" data-testid={`item-size-${z.replace(/\s+/g, '').toLowerCase()}`} aria-pressed={z === size} onClick={() => setSize(z)}>
                {label}
              </button>
            )
          })}
        </div>
        <h3>{TH.sweetness}</h3>
        <div className="choices">
          {SWEETNESS_ORDER.filter((w) => sweetChoices.includes(w)).map((w) => (
            <button key={w} type="button" data-testid={`item-sweet-${w}`} aria-pressed={w === sweetness} onClick={() => setSweetness(w)}>
              {w}
            </button>
          ))}
        </div>
        <h3>{TH.milk}</h3>
        <div className="choices">
          {opts.milk.map((m) => (
            <button key={m.code} type="button" data-testid={`item-milk-${m.code}`} aria-pressed={m.code === milk} onClick={() => setMilk(m.code)}>
              {m.code === 'oat' ? TH.milkOat : TH.milkFresh}
              {m.priceAddSatang > 0 && ` +${formatBaht(m.priceAddSatang)}`}
            </button>
          ))}
        </div>
        {menu.isMatcha && (
          <>
            <h3>{TH.grade}</h3>
            <div className="choices">
              {opts.grades.map((g) => (
                <button key={g.code} type="button" data-testid={`item-grade-${g.code}`} aria-pressed={g.code === grade} onClick={() => setGrade(g.code)}>
                  {g.code}
                  {g.priceAddSatang > 0 && ` +${formatBaht(g.priceAddSatang)}`}
                </button>
              ))}
            </div>
          </>
        )}
        <div className="big-amount">{price === null ? TH.noPrice : formatBaht(price)}</div>
        <div className="actions">
          <button type="button" data-testid="item-cancel" onClick={onClose}>
            {TH.cancel}
          </button>
          <button type="button" className="primary" data-testid="item-add" disabled={price === null} onClick={add}>
            {TH.addToCart}
          </button>
        </div>
      </div>
    </div>
  )
}
