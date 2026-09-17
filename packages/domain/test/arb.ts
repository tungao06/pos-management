import fc from 'fast-check'

export const satangArb = fc.integer({ min: 0, max: 10_000_000 })          // ถึง 100,000 บาท
export const qtyArb = fc.integer({ min: 1, max: 99 })
export const milliArb = fc.integer({ min: 1, max: 5_000_000 })            // ถึง 5,000 หน่วย
export const usatArb = fc.integer({ min: 0, max: 2_000_000_000 })          // ถึง 20 บาท/หน่วย
export const isoDateArb = fc.date({ min: new Date('2020-01-01'), max: new Date('2035-12-31'), noInvalidDate: true }).map((d) => d.toISOString())
export const idArb = fc.uuid()
