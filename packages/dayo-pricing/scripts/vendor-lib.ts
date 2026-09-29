import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * spec 04 §5.1: dayo's pricing files and everything they import (not xlsx). promoRule.ts joined with dayo's rule engine
 * (ADR-0071 · plan 10 T1); it and money.ts import each other, both inside the set.
 */
export const VENDORED: readonly string[] = ['money', 'promotions', 'promoRule', 'cost', 'fmt', 'shopSettings', 'types', 'time'].map((n) => `packages/shared/src/${n}.ts`)

/**
 * dayo's golden promo-rule cases (ADR-0071 ข้อ 5/11 · plan 10 R1): every *.json directly in this folder plus load.ts,
 * copied byte for byte from the pinned commit. README.md, the record-*.ts recorders and subfolders stay in dayo.
 */
export const GOLDEN_DIR = 'packages/shared/test/fixtures/promo-rules'
const isGoldenName = (name: string): boolean => name === 'load.ts' || (name.endsWith('.json') && !name.includes('/'))

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const vendorDirOf = (root: string): string => join(root, 'src', 'vendor')
const goldenDirOf = (root: string): string => join(root, 'golden', 'test', 'fixtures', 'promo-rules')
export const VENDOR_DIR = vendorDirOf(ROOT)
export const GOLDEN_LOCAL_DIR = goldenDirOf(ROOT)
const vendorJsonOf = (root: string): string => join(root, 'VENDOR.json')

/** `files` = the 8 pricing files (what E1 `pricing.files_sha256` is compared with) · `fixtures` = the golden cases. */
export type VendorJson = { repo: 'dayo-shop-system'; commit: string; files: Record<string, string>; fixtures: Record<string, string> }

export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex')
/**
 * The POS hash rule for E1 `pricing.files_sha256` (block-1 plan Task 7 · interpretation 6): UTF-8 text after
 * CRLF → LF. dayo hashes raw bytes today; the results agree only while dayo's files are LF. VENDOR.json MUST use the same rule, or a Windows checkout shows the yellow banner for ever.
 */
export const fileSha256 = (bytes: Uint8Array): string => sha256(Buffer.from(bytes).toString('utf8').replace(/\r\n/g, '\n'))
const baseName = (dayoPath: string): string => dayoPath.split('/').pop()!

function git(dayoRepo: string, args: string[]): Buffer {
  return execFileSync('git', ['-C', dayoRepo, ...args], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
}
const resolveCommit = (dayoRepo: string, ref: string): string => git(dayoRepo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).toString('utf8').trim()
/** The committed bytes of `path` at `commit`, or null when the path is not there. */
function showAt(dayoRepo: string, commit: string, path: string): Buffer | null {
  try { return git(dayoRepo, ['show', `${commit}:${path}`]) } catch { return null }
}

/** The golden fixture paths (dayo paths, sorted) that vendor:update copies from `ref`: blobs directly in GOLDEN_DIR, *.json + load.ts. */
export function goldenPathsAt(dayoRepo: string, ref: string): string[] {
  const commit = resolveCommit(dayoRepo, ref)
  const out: string[] = []
  for (const line of git(dayoRepo, ['ls-tree', '-z', commit, `${GOLDEN_DIR}/`]).toString('utf8').split('\0')) {
    const m = /^\d+ (\w+) [0-9a-f]+\t(.+)$/.exec(line)
    if (m === null || m[1] !== 'blob') continue
    const path = m[2]!
    if (path.startsWith(`${GOLDEN_DIR}/`) && isGoldenName(path.slice(GOLDEN_DIR.length + 1))) out.push(path)
  }
  return out.sort()
}

/** Checks one pinned group: the local folder holds exactly the pinned names, each with the pinned sha256. */
function checkGroup(dir: string, pinned: Record<string, string>, problems: string[]): void {
  const want = new Map(Object.keys(pinned).map((p) => [baseName(p), p]))
  let present: string[] = []
  try { present = readdirSync(dir) } catch { /* reported per file below */ }
  for (const f of present) if (!want.has(f)) problems.push(`${join(dir, f)}: not pinned in VENDOR.json — remove it or re-run vendor:update`)
  for (const [f, p] of want) {
    let got: string
    try { got = fileSha256(readFileSync(join(dir, f))) } catch { problems.push(`${p}: missing ${join(dir, f)}`); continue }
    if (got !== pinned[p]) problems.push(`${p}: sha256 ${got} ≠ VENDOR.json ${String(pinned[p])} — ตัวคิดราคาในเครื่องไม่ตรงรุ่นกับ dayo`)
  }
}

/** Problems as readable lines; [] = the vendored copy (pricing files + golden fixtures) is exactly what VENDOR.json pins. */
export function checkVendor(root: string = ROOT): string[] {
  const v = JSON.parse(readFileSync(vendorJsonOf(root), 'utf8')) as Partial<VendorJson>
  const problems: string[] = []
  if (v.repo !== 'dayo-shop-system') problems.push(`repo must be dayo-shop-system, got ${String(v.repo)}`)
  if (typeof v.commit !== 'string' || !/^[0-9a-f]{40}$/.test(v.commit)) problems.push(`commit must be a 40-character sha, got ${String(v.commit)}`)
  const files = v.files ?? {}
  const listed = Object.keys(files).sort()
  if (JSON.stringify(listed) !== JSON.stringify([...VENDORED].sort())) problems.push(`VENDOR.json lists [${listed.join(', ')}], expected [${VENDORED.join(', ')}]`)
  const pinnedFiles: Record<string, string> = {}
  for (const p of VENDORED) pinnedFiles[p] = files[p] ?? '(not pinned)'
  checkGroup(vendorDirOf(root), pinnedFiles, problems)

  const fixtures = v.fixtures ?? {}
  const keys = Object.keys(fixtures)
  if (keys.length === 0) problems.push('VENDOR.json.fixtures is empty — the golden promo-rule cases are not pinned (plan 10 R1)')
  else if (!keys.includes(`${GOLDEN_DIR}/load.ts`)) problems.push(`VENDOR.json.fixtures lacks ${GOLDEN_DIR}/load.ts`)
  for (const k of keys) {
    if (!k.startsWith(`${GOLDEN_DIR}/`) || !isGoldenName(k.slice(GOLDEN_DIR.length + 1))) problems.push(`VENDOR.json.fixtures: ${k} is not a golden fixture (*.json or load.ts directly in ${GOLDEN_DIR})`)
  }
  checkGroup(goldenDirOf(root), fixtures, problems)
  return problems
}

/**
 * Copies the COMMITTED bytes (git show — never the working tree, which may carry CRLF) of the pricing files and the
 * golden fixtures at one commit, and rewrites VENDOR.json. Stale golden files are removed so the folder = the pin.
 */
export function updateVendor(dayoRepo: string, commit: string, root: string = ROOT): VendorJson {
  const full = resolveCommit(dayoRepo, commit)
  const vendorDir = vendorDirOf(root)
  mkdirSync(vendorDir, { recursive: true })
  const files: Record<string, string> = {}
  for (const p of VENDORED) {
    const bytes = showAt(dayoRepo, full, p)
    if (bytes === null) throw new Error(`${p} is not in dayo at ${full}`)
    writeFileSync(join(vendorDir, baseName(p)), bytes)
    files[p] = fileSha256(bytes)
  }
  const golden = goldenPathsAt(dayoRepo, full)
  if (!golden.includes(`${GOLDEN_DIR}/load.ts`)) throw new Error(`${GOLDEN_DIR}/load.ts is not in dayo at ${full} — the golden shim (R1) needs it`)
  const goldenDir = goldenDirOf(root)
  mkdirSync(goldenDir, { recursive: true })
  const keep = new Set(golden.map(baseName))
  for (const f of readdirSync(goldenDir)) if (!keep.has(f)) rmSync(join(goldenDir, f), { recursive: true })
  const fixtures: Record<string, string> = {}
  for (const p of golden) {
    const bytes = showAt(dayoRepo, full, p)!
    writeFileSync(join(goldenDir, baseName(p)), bytes)
    fixtures[p] = fileSha256(bytes)
  }
  const out: VendorJson = { repo: 'dayo-shop-system', commit: full, files, fixtures }
  writeFileSync(vendorJsonOf(root), `${JSON.stringify(out, null, 2)}\n`)
  return out
}

/**
 * vendor:drift — does dayo at `ref` (default main) still hold exactly what VENDOR.json pins? Compares content, not the
 * commit id: dayo main moving on through unrelated files is not drift. [] = no drift. An unknown ref throws.
 * Reports pinned files that changed or vanished at `ref`, and golden fixtures that exist at `ref` but are not pinned.
 */
export function driftAgainst(dayoRepo: string, ref = 'main', root: string = ROOT): string[] {
  const v = JSON.parse(readFileSync(vendorJsonOf(root), 'utf8')) as VendorJson
  const at = resolveCommit(dayoRepo, ref)
  const problems: string[] = []
  const pinned: Record<string, string> = { ...v.files, ...v.fixtures }
  for (const [p, want] of Object.entries(pinned)) {
    const bytes = showAt(dayoRepo, at, p)
    if (bytes === null) { problems.push(`${p}: missing at ${ref} (${at.slice(0, 7)})`); continue }
    const got = fileSha256(bytes)
    if (got !== want) problems.push(`${p}: sha256 at ${ref} (${at.slice(0, 7)}) ${got} ≠ pin ${want}`)
  }
  for (const p of goldenPathsAt(dayoRepo, at)) if (!(p in (v.fixtures ?? {}))) problems.push(`${p}: new at ${ref} (${at.slice(0, 7)}), not pinned`)
  return problems
}

/** The commit `ref` points at in the dayo repo (for the drift report). */
export const commitOf = (dayoRepo: string, ref: string): string => resolveCommit(dayoRepo, ref)
