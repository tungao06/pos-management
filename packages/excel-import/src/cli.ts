import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { buildSeed } from './build-seed.js'
import { openWorkbook } from './cells.js'

const [xlsxPath, outPath] = process.argv.slice(2)
if (!xlsxPath || !outPath) {
  console.error('usage: pnpm --filter @dayo/excel-import import <path-to.xlsx> <out.json>')
  process.exit(2)
}
const seed = buildSeed(await openWorkbook(xlsxPath))
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(seed, null, 2) + '\n', 'utf8')
console.log(`wrote ${outPath}: ${seed.items.length} items, ${seed.recipes.length} recipes`)
