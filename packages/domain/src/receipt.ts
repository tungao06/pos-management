const PREFIX_RE = /^[A-Z]{1,3}$/
const RECEIPT_RE = /^([A-Z]{1,3})-(\d{6})$/

export function formatReceiptNo(prefix: string, counter: number): string {
  if (!PREFIX_RE.test(prefix)) throw new RangeError(`bad receipt prefix "${prefix}"`)
  if (!Number.isInteger(counter) || counter < 1 || counter > 999_999) throw new RangeError(`bad receipt counter ${counter}`)
  return `${prefix}-${String(counter).padStart(6, '0')}`
}

export function parseReceiptNo(s: string): { prefix: string; counter: number } {
  const m = RECEIPT_RE.exec(s)
  if (!m) throw new RangeError(`bad receipt number "${s}"`)
  return { prefix: m[1]!, counter: Number(m[2]) }
}

/** Next receipt number for `prefix` given the device's latest one (spec §4.7: no gaps, no duplicates). */
export function nextReceiptNo(prefix: string, lastReceiptNo: string | null): string {
  if (lastReceiptNo === null) return formatReceiptNo(prefix, 1)
  const last = parseReceiptNo(lastReceiptNo)
  if (last.prefix !== prefix) throw new RangeError(`last receipt ${lastReceiptNo} does not belong to prefix ${prefix}`)
  return formatReceiptNo(prefix, last.counter + 1)
}
