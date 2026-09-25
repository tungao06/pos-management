import { checkVendor, updateVendor } from './vendor-lib.js'

const [cmd, repo, commit = 'HEAD'] = process.argv.slice(2)
if (cmd === 'check') {
  const problems = checkVendor()
  for (const p of problems) console.error(p)
  process.exit(problems.length === 0 ? 0 : 1)
} else if (cmd === 'update' && repo !== undefined) {
  const v = updateVendor(repo, commit)
  console.log(`vendored ${Object.keys(v.files).length} files from ${v.commit} — now run the parity test (spec 04 §5.2 layer C)`)
} else {
  console.error('usage: vendor.ts check | vendor.ts update <path-to-dayo-shop-system> [commit]')
  process.exit(2)
}
