import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { checkVendor, fileSha256, VENDOR_DIR, VENDORED } from '../scripts/vendor-lib.js'
import { computeOrder } from '../src/index.js'

describe('vendored dayo pricing (spec 04 §5.1, D72)', () => {
  it('every vendored file matches VENDOR.json byte for byte', () => {
    expect(checkVendor()).toEqual([])
  })
  it('src/vendor holds exactly the vendored set', () => {
    expect(readdirSync(VENDOR_DIR).sort()).toEqual(VENDORED.map((p) => p.split('/').pop()).sort())
  })
  it('the set is closed: every relative import of a vendored file is another vendored file', () => {
    const names = new Set(VENDORED.map((p) => p.split('/').pop()!.replace(/\.ts$/, '')))
    for (const file of readdirSync(VENDOR_DIR)) {
      for (const m of readFileSync(join(VENDOR_DIR, file), 'utf8').matchAll(/from\s+"\.\/([^"]+)"/g)) expect(names.has(m[1]!), `${file} imports ./${m[1]}`).toBe(true)
    }
  })
  it('computeOrder is reachable through the package entry', () => {
    expect(typeof computeOrder).toBe('function')
  })
  it('hashes like dayo: a CRLF copy has the same sha256 as the LF original (block-1 interpretation 6)', () => {
    const lf = Buffer.from('a\nb\n', 'utf8')
    const crlf = Buffer.from('a\r\nb\r\n', 'utf8')
    expect(fileSha256(crlf)).toBe(fileSha256(lf))
    expect(fileSha256(lf)).toBe(createHash('sha256').update('a\nb\n', 'utf8').digest('hex'))
  })
})
