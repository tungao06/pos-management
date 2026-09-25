import { loadRichCatalog } from '@dayo/contracts/fixture-files'
import { toPricingCatalog, type PosOrderCatalog } from '../../src/price-cart.js'

/** The one test catalog of block 2 on the POS side: packages/contracts/fixtures/pos-test/e1-catalog-rich.json (Task 6). Never re-type a catalog in a test. */
export const POS_CATALOG: PosOrderCatalog = toPricingCatalog(loadRichCatalog().catalog)
