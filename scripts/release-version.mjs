// scripts/release-version.mjs — bump apps/pos/package.json's version only (owner ask: see which deploy is
// running). Never touches git (no tag, no commit) — the owner reviews the diff and commits it like any other
// change, same as everything else in this repo (D106).
// Usage (root):
//   pnpm release:version patch|minor|major

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const PKG_PATH = fileURLToPath(new URL('../apps/pos/package.json', import.meta.url))
const KINDS = ['patch', 'minor', 'major']
const kind = process.argv[2]

if (!KINDS.includes(kind ?? '')) {
  console.error('usage: pnpm release:version patch|minor|major')
  process.exit(1)
}

const raw = readFileSync(PKG_PATH, 'utf8')
const pkg = JSON.parse(raw)
const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(pkg.version ?? ''))
if (!m) {
  console.error(`apps/pos/package.json version "${pkg.version}" is not a plain semver (x.y.z) — bump it by hand`)
  process.exit(1)
}
let [major, minor, patch] = m.slice(1).map(Number)
if (kind === 'major') {
  major += 1
  minor = 0
  patch = 0
} else if (kind === 'minor') {
  minor += 1
  patch = 0
} else {
  patch += 1
}
const next = `${major}.${minor}.${patch}`
pkg.version = next
writeFileSync(PKG_PATH, `${JSON.stringify(pkg, null, 2)}\n`)
console.log(`apps/pos/package.json version: ${m[0]} -> ${next}`)
