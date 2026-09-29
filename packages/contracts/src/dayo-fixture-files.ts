// packages/contracts/src/dayo-fixture-files.ts — Node only
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PosCatalogResponse, type PosCatalogData } from './dayo-api.js'
import { CONTRACT_FIXTURE_NAMES, PosContractFixture } from './dayo-fixture.js'

const DIR = fileURLToPath(new URL('../fixtures/dayo-api/', import.meta.url))
/** D82: sha256 of the UTF-8 text after CRLF → LF (the same rule as fileSha256 of Task 2), so a Windows checkout still matches. */
export const fixtureSha256 = (bytes: Uint8Array): string => createHash('sha256').update(Buffer.from(bytes).toString('utf8').replace(/\r\n/g, '\n')).digest('hex')
/** One entry per CONTRACT_FIXTURE_NAMES name, in list order; sha256 null = the file is missing in `dir`. */
export function contractFixtureHashes(dir: string = DIR): { name: string; sha256: string | null }[] {
  return CONTRACT_FIXTURE_NAMES.map((name) => {
    const p = join(dir, `${name}.json`)
    return { name, sha256: existsSync(p) ? fixtureSha256(readFileSync(p)) : null }
  })
}
const RICH = fileURLToPath(new URL('../fixtures/pos-test/e1-catalog-rich.json', import.meta.url))
/** Sorted by NAME like CONTRACT_FIXTURE_NAMES — by file name '-' < '.' would put e1-catalog-changed-block3.json first. */
export const listContractFixtures = (): string[] => readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -'.json'.length)).sort().map((n) => join(DIR, `${n}.json`))
export const loadContractFixture = (name: string): PosContractFixture => PosContractFixture.parse(JSON.parse(readFileSync(join(DIR, `${name}.json`), 'utf8')))
export function loadRichCatalog(): Extract<PosCatalogData, { changed: true }> {
  const d = PosCatalogResponse.parse(JSON.parse(readFileSync(RICH, 'utf8'))).data
  if (!d.changed) throw new Error('e1-catalog-rich.json must be changed:true')
  return d
}
