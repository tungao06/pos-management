import type { JSX } from 'react'
import type { CashInputs, SalesSummary, ZVoid } from '@dayo/domain'
import type { NegativeBaseDto } from '../api/types'
import { formatBaht } from '../ui/format'
import { TH } from '../ui/th'

const TIME = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })

function Row({ label, value, testId }: { label: string; value: string; testId: string }): JSX.Element {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td data-testid={testId}>{value}</td>
    </tr>
  )
}

/** Sales block shared by the X report and the Z report (`p` = testid prefix: x / z). */
export function SalesTable({ sales, p }: { sales: SalesSummary; p: string }): JSX.Element {
  return (
    <section>
      <h2>{TH.salesTitle}</h2>
      <table className="figures">
        <tbody>
          <Row label={TH.receiptCount} value={String(sales.orderCount)} testId={`${p}-orders`} />
          <Row label={TH.voidCount} value={String(sales.voidCount)} testId={`${p}-voids`} />
          <Row label={TH.grossSales} value={formatBaht(sales.grossSalesSatang)} testId={`${p}-gross`} />
          <Row label={TH.discounts} value={`−${formatBaht(sales.discountSatang)}`} testId={`${p}-discount`} />
          <Row label={TH.voidedSales} value={`−${formatBaht(sales.voidedSatang)}`} testId={`${p}-voided`} />
          <Row label={TH.netSales} value={formatBaht(sales.netSalesSatang)} testId={`${p}-net`} />
          <Row label={TH.cashSales} value={formatBaht(sales.cashSalesSatang)} testId={`${p}-cash-sales`} />
        </tbody>
      </table>
    </section>
  )
}

/**
 * Q3b-12 · D53: PromptPay received / transferred back / net — the figure to compare with the bank app. With `bank`
 * (the Z report) also the bank-app total the owner typed and the frozen difference (bank − net).
 */
export function QrTable({ sales, p, bank }: { sales: SalesSummary; p: string; bank?: { totalSatang: number | null; differenceSatang: number | null } }): JSX.Element {
  return (
    <section>
      <h2>{TH.qrSummaryTitle}</h2>
      <table className="figures">
        <tbody>
          <Row label={TH.qrSales} value={formatBaht(sales.qrSalesSatang)} testId={`${p}-qr-sales`} />
          <Row label={TH.qrRefunded} value={`−${formatBaht(sales.qrRefundedSatang)}`} testId={`${p}-qr-refunded`} />
          <Row label={TH.qrNet} value={formatBaht(sales.qrNetSatang)} testId={`${p}-qr-net`} />
          {bank !== undefined && (
            <>
              <Row label={TH.bankQrTotal} value={bank.totalSatang === null ? TH.bankQrNotEntered : formatBaht(bank.totalSatang)} testId={`${p}-bank-qr`} />
              <Row label={TH.qrDifference} value={bank.differenceSatang === null ? '—' : formatBaht(bank.differenceSatang)} testId={`${p}-qr-diff`} />
            </>
          )}
        </tbody>
      </table>
    </section>
  )
}

/**
 * D36: expected = opening + cash sales − void refunds + paid in − paid out − drops. `hideExpected` (the X report of an
 * open shift) leaves the expected line out so the drawer is counted blind at close (Q3b-3 · D52 · review I-2).
 */
export function DrawerTable({ cash, expectedSatang, p, hideExpected = false }: { cash: CashInputs; expectedSatang: number; p: string; hideExpected?: boolean }): JSX.Element {
  return (
    <section>
      <h2>{TH.drawerTitle}</h2>
      <table className="figures">
        <tbody>
          <Row label={TH.openingFloat} value={formatBaht(cash.openingFloatSatang)} testId={`${p}-opening`} />
          <Row label={TH.cashSales} value={`+${formatBaht(cash.cashSalesSatang)}`} testId={`${p}-drawer-cash-sales`} />
          <Row label={TH.voidRefunds} value={`−${formatBaht(cash.voidRefundsSatang)}`} testId={`${p}-void-refunds`} />
          <Row label={TH.paidIn} value={`+${formatBaht(cash.paidInSatang)}`} testId={`${p}-paid-in`} />
          <Row label={TH.paidOut} value={`−${formatBaht(cash.paidOutSatang)}`} testId={`${p}-paid-out`} />
          <Row label={TH.drops} value={`−${formatBaht(cash.dropsSatang)}`} testId={`${p}-drops`} />
          {!hideExpected && <Row label={TH.expectedCash} value={formatBaht(expectedSatang)} testId={`${p}-expected`} />}
        </tbody>
      </table>
      {hideExpected && <p data-testid={`${p}-expected-hidden`}>{TH.xExpectedHidden}</p>}
    </section>
  )
}

/** The daily void report (D50 Q3-22): who approved, why, made or not, QR refund reference. */
export function VoidList({ voids, p }: { voids: readonly ZVoid[]; p: string }): JSX.Element {
  return (
    <section>
      <h2>{TH.voidListTitle}</h2>
      {voids.length === 0 && <p>{TH.noVoids}</p>}
      <ul className="list">
        {voids.map((v) => (
          <li key={v.orderId} data-testid={`${p}-void-${v.receiptNo}`}>
            <strong>{v.receiptNo}</strong> · {TIME.format(new Date(v.voidedAt))} · {formatBaht(v.totalSatang)} · {v.method === 'CASH' ? TH.methodCash : TH.methodPromptPay} · {v.reason} ·{' '}
            {v.made ? TH.voidWasMade : TH.voidNotMade} · {TH.voidApprovedBy(v.approvedByName)}
            {v.refundReference !== null && ` · ${TH.voidQrRefundRef} ${v.refundReference}`}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** D28: the close screen must show the bases that went negative. */
export function NegativeBaseList({ items }: { items: readonly NegativeBaseDto[] }): JSX.Element {
  return (
    <section>
      <h2>{TH.negativeBasesTitle}</h2>
      {items.length === 0 && <p>{TH.noNegativeBases}</p>}
      <ul className="list">
        {items.map((b) => (
          <li key={b.itemId} className="error" data-testid={`neg-base-${b.code}`}>
            {b.name} ({b.code}) {(b.onHandMilli / 1000).toLocaleString('en-US')} {b.useUnit}
          </li>
        ))}
      </ul>
    </section>
  )
}
