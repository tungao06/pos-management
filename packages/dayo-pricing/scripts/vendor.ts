import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { checkVendor, commitOf, driftAgainst, updateVendor, type VendorJson } from './vendor-lib.js'

const [cmd, repo, ref] = process.argv.slice(2)
if (cmd === 'check') {
  const problems = checkVendor()
  for (const p of problems) console.error(p)
  process.exit(problems.length === 0 ? 0 : 1)
} else if (cmd === 'update' && repo !== undefined) {
  const v = updateVendor(repo, ref ?? 'HEAD')
  console.log(`vendored ${Object.keys(v.files).length} files + ${Object.keys(v.fixtures).length} golden fixtures from ${v.commit} — now run the golden and parity tests (spec 04 §5.2 layer C)`)
  // consumers type-check against dist/types (.d.ts), not src: rebuild it now, or they keep checking the old engine
  execSync('pnpm run build:types', { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'inherit' })
} else if (cmd === 'drift' && repo !== undefined) {
  const target = ref ?? 'main'
  const problems = driftAgainst(repo, target)
  for (const p of problems) console.error(p)
  const pin = (JSON.parse(readFileSync(new URL('../VENDOR.json', import.meta.url), 'utf8')) as VendorJson).commit
  const at = commitOf(repo, target)
  if (problems.length === 0) console.log(`no drift: dayo ${target} (${at.slice(0, 7)}) holds exactly the pinned files of ${pin.slice(0, 7)}${at === pin ? '' : ' (different commit, same bytes)'}`)
  else console.error(`drift: dayo ${target} (${at.slice(0, 7)}) ≠ pin ${pin.slice(0, 7)} — ask the owner whether to re-vendor before merge`)
  process.exit(problems.length === 0 ? 0 : 1)
} else {
  console.error('usage: vendor.ts check | vendor.ts update <path-to-dayo-shop-system> [commit] | vendor.ts drift <path-to-dayo-shop-system> [ref=main]')
  process.exit(2)
}
