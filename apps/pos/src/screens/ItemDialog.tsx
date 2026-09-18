import { useState, type JSX } from 'react'
import type { MenuDto, MenuProduct } from '../api/types'
import { useCart } from '../app/cart-context'
import { formatBaht } from '../ui/format'
import { TH } from '../ui/th'

/** Popup on every tap with 16 oz / 50% preselected (spec §5 · D48 Q3-10). */
export function ItemDialog({ menu, product, onClose }: { menu: MenuDto; product: MenuProduct; onClose: () => void }): JSX.Element {
  const { dispatch } = useCart()
  const [sizeId, setSizeId] = useState(menu.defaultSizeId)
  const [sweetnessId, setSweetnessId] = useState(menu.defaultSweetnessId)
  const variant = menu.variants.find((v) => v.productId === product.id && v.sizeId === sizeId)
  const size = menu.sizes.find((z) => z.id === sizeId)
  const sweetness = menu.sweetness.find((x) => x.id === sweetnessId)
  const price = variant?.priceSatang ?? null
  const sizesOfProduct = menu.sizes.filter((z) => menu.variants.some((v) => v.productId === product.id && v.sizeId === z.id))

  const add = (): void => {
    if (!variant || price === null || !size || !sweetness) return
    dispatch({
      type: 'add',
      line: { variantId: variant.id, sweetnessId, productName: product.nameTh, sizeName: size.name, sweetnessName: sweetness.name, unitPriceSatang: price },
    })
    onClose()
  }

  return (
    <div className="dialog-backdrop" role="dialog" aria-label={product.nameTh}>
      <div className="dialog">
        <h2>{product.nameTh}</h2>
        <h3>{TH.size}</h3>
        <div className="choices">
          {sizesOfProduct.map((z) => (
            <button key={z.id} type="button" data-testid={`size-${z.code}`} aria-pressed={z.id === sizeId} onClick={() => setSizeId(z.id)}>
              {z.name}
            </button>
          ))}
        </div>
        <h3>{TH.sweetness}</h3>
        <div className="choices">
          {menu.sweetness.map((x) => (
            <button key={x.id} type="button" data-testid={`sweet-${x.code}`} aria-pressed={x.id === sweetnessId} onClick={() => setSweetnessId(x.id)}>
              {x.name}
            </button>
          ))}
        </div>
        <div className="big-amount">{price === null ? TH.noPrice : formatBaht(price)}</div>
        <div className="actions">
          <button type="button" onClick={onClose}>
            {TH.cancel}
          </button>
          <button type="button" className="primary" data-testid="add-to-cart" disabled={price === null} onClick={add}>
            {TH.addToCart}
          </button>
        </div>
      </div>
    </div>
  )
}
