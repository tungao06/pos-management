import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** spec 04 §5.1: dayo's pricing files and everything they import (not xlsx). */
export const VENDORED = ['money', 'promotions', 'cost', 'fmt', 'shopSettings', 'types', 'time'].map((n) => `packages/shared/src/${n}.ts`)

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const VENDOR_DIR = join(ROOT, 'src', 'vendor')
const VENDOR_JSON = join(ROOT, 'VENDOR.json')

export type VendorJson = { repo: 'dayo-shop-system'; commit: string; files: Record<string, string> }

export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex')
/**
 * The POS hash rule for E1 `pricing.files_sha256` (block-1 plan Task 7 · interpretation 6): UTF-8 text after
 * CRLF → LF. dayo hashes raw bytes today; the results agree only while dayo's files are LF. VENDOR.json MUST use the same rule, or a Windows checkout shows the yellow banner for ever.
 */
export const fileSha256 = (bytes: Uint8Array): string => sha256(Buffer.from(bytes).toString('utf8').replace(/\r\n/g, '\n'))
const localPath = (dayoPath: string): string => join(VENDOR_DIR, dayoPath.split('/').pop()!)

/** Problems as readable lines; [] = the vendored copy is exactly what VENDOR.json pins. */
export function checkVendor(): string[] {
  const v = JSON.parse(readFileSync(VENDOR_JSON, 'utf8')) as VendorJson
  const problems: string[] = []
  if (v.repo !== 'dayo-shop-system') problems.push(`repo must be dayo-shop-system, got ${String(v.repo)}`)
  if (!/^[0-9a-f]{40}$/.test(v.commit)) problems.push(`commit must be a 40-character sha, got ${String(v.commit)}`)
  const listed = Object.keys(v.files).sort()
  if (JSON.stringify(listed) !== JSON.stringify([...VENDORED].sort())) problems.push(`VENDOR.json lists [${listed.join(', ')}], expected [${VENDORED.join(', ')}]`)
  for (const p of VENDORED) {
    let got: string
    try { got = fileSha256(readFileSync(localPath(p))) } catch { problems.push(`missing ${localPath(p)}`); continue }
    if (got !== v.files[p]) problems.push(`${p}: sha256 ${got} ≠ VENDOR.json ${String(v.files[p])} — ตัวคิดราคาในเครื่องไม่ตรงรุ่นกับ dayo`)
  }
  return problems
}

/** Copies the COMMITTED bytes (git show — never the working tree, which may carry CRLF) and rewrites VENDOR.json. */
export function updateVendor(dayoRepo: string, commit: string): VendorJson {
  const full = execFileSync('git', ['-C', dayoRepo, 'rev-parse', `${commit}^{commit}`], { encoding: 'utf8' }).trim()
  mkdirSync(VENDOR_DIR, { recursive: true })
  const files: Record<string, string> = {}
  for (const p of VENDORED) {
    const bytes = execFileSync('git', ['-C', dayoRepo, 'show', `${full}:${p}`])
    writeFileSync(localPath(p), bytes)
    files[p] = fileSha256(bytes)
  }
  const out: VendorJson = { repo: 'dayo-shop-system', commit: full, files }
  writeFileSync(VENDOR_JSON, `${JSON.stringify(out, null, 2)}\n`)
  return out
}
