import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import {
  checkVendor, driftAgainst, fileSha256, GOLDEN_DIR, GOLDEN_LOCAL_DIR, goldenPathsAt, VENDOR_DIR, VENDORED, type VendorJson,
} from '../scripts/vendor-lib.js'
import {
  computeOrder, isValidSizeCode, normPromoCode, promoApplyMode, PROMO_RULE_VERSIONS, promoRuleMinVersion, promoToLegacy, selectablePromotions,
  validatePromoRule, validateTimeWindows,
} from '../src/index.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const pin = JSON.parse(readFileSync(join(ROOT, 'VENDOR.json'), 'utf8')) as VendorJson
const name = (dayoPath: string): string => dayoPath.split('/').pop()!

const scratch: string[] = []
const tempDir = (): string => { const d = mkdtempSync(join(tmpdir(), 'dayo-pricing-')); scratch.push(d); return d }
afterAll(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }) })

describe('vendored dayo pricing (spec 04 §5.1, D72)', () => {
  it('every vendored file and golden fixture matches VENDOR.json byte for byte', () => {
    expect(checkVendor()).toEqual([])
  })
  it('vendors dayo\'s 8 pricing files — promoRule.ts joined the set with the rule engine (ADR-0071, plan 10 T1)', () => {
    expect([...VENDORED].sort()).toEqual(['cost', 'fmt', 'money', 'promoRule', 'promotions', 'shopSettings', 'time', 'types'].map((n) => `packages/shared/src/${n}.ts`))
    expect(Object.keys(pin.files).sort()).toEqual([...VENDORED].sort())
  })
  it('pins dayo main f4cda56 (owner answer Q5, 30 Sep 2026)', () => {
    expect(pin.commit).toBe('f4cda56f7b3515cbb3ea3f301e8461f6c720b7f4')
  })
  it('pins dayo\'s golden promo-rule fixtures in VENDOR.json.fixtures: every *.json plus load.ts (R1)', () => {
    const keys = Object.keys(pin.fixtures ?? {})
    expect(keys.length).toBeGreaterThan(0)
    expect(keys).toContain(`${GOLDEN_DIR}/load.ts`)
    expect(keys).toContain(`${GOLDEN_DIR}/catalog.json`)
    for (const k of keys) expect(k, k).toMatch(/^packages\/shared\/test\/fixtures\/promo-rules\/([^/]+\.json|load\.ts)$/)
  })
  it('src/vendor holds exactly the vendored set', () => {
    expect(readdirSync(VENDOR_DIR).sort()).toEqual(VENDORED.map(name).sort())
  })
  it('golden/test/fixtures/promo-rules holds exactly the pinned fixtures', () => {
    expect(readdirSync(GOLDEN_LOCAL_DIR).sort()).toEqual(Object.keys(pin.fixtures).map(name).sort())
  })
  it('the set is closed: every relative import of a vendored file is another vendored file (promoRule ↔ money is a cycle inside the set)', () => {
    const names = new Set(VENDORED.map((p) => name(p).replace(/\.ts$/, '')))
    const importsOf = (f: string): string[] => [...readFileSync(join(VENDOR_DIR, f), 'utf8').matchAll(/from\s+"\.\/([^"]+)"/g)].map((m) => m[1]!)
    for (const file of readdirSync(VENDOR_DIR)) {
      for (const m of importsOf(file)) expect(names.has(m), `${file} imports ./${m}`).toBe(true)
    }
    expect(importsOf('promoRule.ts')).toContain('money')
    expect(importsOf('promotions.ts')).toContain('promoRule')
  })
  it('no vendored file imports a package (the copy must stand alone)', () => {
    for (const file of readdirSync(VENDOR_DIR)) {
      for (const m of readFileSync(join(VENDOR_DIR, file), 'utf8').matchAll(/from\s+"([^"]+)"/g)) expect(m[1]!.startsWith('./'), `${file} imports ${m[1]}`).toBe(true)
    }
  })
  it('computeOrder is reachable through the package entry', () => {
    expect(typeof computeOrder).toBe('function')
  })
  it('the rule engine\'s API is reachable through the package entry (plan 10 T1 Produces)', () => {
    for (const f of [normPromoCode, promoApplyMode, selectablePromotions, validatePromoRule, validateTimeWindows, promoToLegacy, promoRuleMinVersion]) {
      expect(typeof f).toBe('function')
    }
    expect(normPromoCode('  code10 ')).toBe('CODE10')
  })
  it('the vendored engine knows promo rule versions 1–2: the tablet asks E1 for max = 2 (owner answer Q5)', () => {
    expect([...PROMO_RULE_VERSIONS]).toEqual([1, 2])
    expect(Math.max(...PROMO_RULE_VERSIONS)).toBe(2)
  })
  it('sizes are dayo cup-size codes, not a closed pair (ADR-0054)', () => {
    expect(isValidSizeCode('22 oz')).toBe(true)
    expect(isValidSizeCode('0 oz')).toBe(false)
    expect(isValidSizeCode('big')).toBe(false)
  })
  it('hashes like dayo: a CRLF copy has the same sha256 as the LF original (block-1 interpretation 6)', () => {
    const lf = Buffer.from('a\nb\n', 'utf8')
    const crlf = Buffer.from('a\r\nb\r\n', 'utf8')
    expect(fileSha256(crlf)).toBe(fileSha256(lf))
    expect(fileSha256(lf)).toBe(createHash('sha256').update('a\nb\n', 'utf8').digest('hex'))
  })
})

describe('checkVendor catches a changed or stray golden fixture', () => {
  const copy = (): string => {
    const root = tempDir()
    cpSync(join(ROOT, 'VENDOR.json'), join(root, 'VENDOR.json'))
    cpSync(VENDOR_DIR, join(root, 'src', 'vendor'), { recursive: true })
    cpSync(GOLDEN_LOCAL_DIR, join(root, 'golden', 'test', 'fixtures', 'promo-rules'), { recursive: true })
    return root
  }
  const goldenOf = (root: string, f: string): string => join(root, 'golden', 'test', 'fixtures', 'promo-rules', f)

  it('an untouched copy is clean', () => {
    expect(checkVendor(copy())).toEqual([])
  })
  it('an edited fixture is reported by its dayo path', () => {
    const root = copy()
    writeFileSync(goldenOf(root, 'legacy-bill.json'), `${readFileSync(goldenOf(root, 'legacy-bill.json'), 'utf8')} `)
    expect(checkVendor(root)).toEqual([expect.stringContaining(`${GOLDEN_DIR}/legacy-bill.json: sha256`)])
  })
  it('a CRLF checkout of a fixture is still clean (D72 rule)', () => {
    const root = copy()
    writeFileSync(goldenOf(root, 'load.ts'), readFileSync(goldenOf(root, 'load.ts'), 'utf8').replace(/\r?\n/g, '\r\n'))
    expect(checkVendor(root)).toEqual([])
  })
  it('a missing fixture and an unpinned extra file are both reported', () => {
    const root = copy()
    rmSync(goldenOf(root, 'rules-tiers.json'))
    writeFileSync(goldenOf(root, 'rules-extra.json'), '{}')
    const problems = checkVendor(root)
    expect(problems).toHaveLength(2)
    expect(problems).toEqual(expect.arrayContaining([expect.stringContaining('rules-tiers.json'), expect.stringContaining('rules-extra.json')]))
  })
  it('a pin without fixtures, or without load.ts, is reported', () => {
    const root = copy()
    const v = JSON.parse(readFileSync(join(root, 'VENDOR.json'), 'utf8')) as VendorJson
    writeFileSync(join(root, 'VENDOR.json'), JSON.stringify({ ...v, fixtures: {} }))
    expect(checkVendor(root)).toEqual(expect.arrayContaining([expect.stringContaining('fixtures')]))
    const { [`${GOLDEN_DIR}/load.ts`]: _load, ...rest } = v.fixtures
    writeFileSync(join(root, 'VENDOR.json'), JSON.stringify({ ...v, fixtures: rest }))
    expect(checkVendor(root)).toEqual(expect.arrayContaining([expect.stringContaining('load.ts')]))
  })
})

/** A throwaway git repo shaped like dayo, holding the vendored bytes (plus files vendor:update must ignore) at its first commit. */
function fakeDayo(): { repo: string; root: string; commit: (msg: string) => string } {
  const repo = tempDir()
  const git = (...args: string[]): string =>
    execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { encoding: 'utf8' }).trim()
  git('init', '-q', '-b', 'main')
  for (const p of VENDORED) { mkdirSync(join(repo, dirname(p)), { recursive: true }); cpSync(join(VENDOR_DIR, name(p)), join(repo, p)) }
  mkdirSync(join(repo, GOLDEN_DIR, 'nested'), { recursive: true })
  for (const p of Object.keys(pin.fixtures)) cpSync(join(GOLDEN_LOCAL_DIR, name(p)), join(repo, p))
  writeFileSync(join(repo, GOLDEN_DIR, 'README.md'), 'not vendored\n')
  writeFileSync(join(repo, GOLDEN_DIR, 'record-golden.ts'), 'export {}\n')
  writeFileSync(join(repo, GOLDEN_DIR, 'nested', 'x.json'), '{}\n')
  const commit = (msg: string): string => { git('add', '-A'); git('commit', '-q', '-m', msg); return git('rev-parse', 'HEAD') }
  const first = commit('init')
  const root = tempDir()
  writeFileSync(join(root, 'VENDOR.json'), JSON.stringify({ ...pin, commit: first }))
  return { repo, root, commit }
}

describe('goldenPathsAt lists what vendor:update copies', () => {
  it('every *.json and load.ts directly in the golden folder — not README, recorders or subfolders', () => {
    const { repo } = fakeDayo()
    expect(goldenPathsAt(repo, 'main')).toEqual(Object.keys(pin.fixtures).sort())
  })
})

describe('driftAgainst (vendor:drift): is the pin still what dayo main holds?', () => {
  it('no drift when the ref holds the pinned bytes, even at a later commit that touched other files', () => {
    const d = fakeDayo()
    writeFileSync(join(d.repo, 'unrelated.txt'), 'x\n')
    d.commit('unrelated')
    expect(driftAgainst(d.repo, 'main', d.root)).toEqual([])
  })
  it('reports a changed pricing file, a changed fixture, a removed fixture and a new fixture', () => {
    const d = fakeDayo()
    writeFileSync(join(d.repo, 'packages/shared/src/promoRule.ts'), `${readFileSync(join(VENDOR_DIR, 'promoRule.ts'), 'utf8')}// changed\n`)
    writeFileSync(join(d.repo, GOLDEN_DIR, 'rules-bill.json'), '{}\n')
    rmSync(join(d.repo, GOLDEN_DIR, 'legacy-mixed.json'))
    writeFileSync(join(d.repo, GOLDEN_DIR, 'rules-new.json'), '{}\n')
    d.commit('drift')
    const got = driftAgainst(d.repo, 'main', d.root)
    expect(got).toHaveLength(4)
    expect(got).toEqual(expect.arrayContaining([
      expect.stringMatching(/^packages\/shared\/src\/promoRule\.ts: /),
      expect.stringMatching(/rules-bill\.json: /),
      expect.stringMatching(/legacy-mixed\.json: .*missing/),
      expect.stringMatching(/rules-new\.json: .*not pinned/),
    ]))
  })
  it('a ref that does not exist is an error, not "no drift"', () => {
    const d = fakeDayo()
    expect(() => driftAgainst(d.repo, 'no-such-branch', d.root)).toThrow()
  })
})
