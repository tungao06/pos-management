// packages/contracts/scripts/fixture-hashes.ts — `pnpm --filter @dayo/contracts fixtures:hashes [dir]` (dir default = the POS copy)
import { contractFixtureHashes } from '../src/dayo-fixture-files.js'

const rows = contractFixtureHashes(process.argv[2])
for (const r of rows) console.log(`${r.sha256 ?? 'MISSING'.padEnd(64)}  ${r.name}.json`)
if (rows.some((r) => r.sha256 === null)) process.exitCode = 1
