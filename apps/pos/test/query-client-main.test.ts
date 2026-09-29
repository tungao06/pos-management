import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// final fix C7: main.tsx renders into #root on import, so its QueryClient is checked by its source — built from
// app/query-client.ts (the options the screen tests use too, src/app/query-client.test.tsx), never its own.
describe('main.tsx QueryClient (final fix C7)', () => {
  it('is built by createQueryClient(), never with options of its own', () => {
    const main = readFileSync(fileURLToPath(new URL('../src/main.tsx', import.meta.url)), 'utf8')
    expect(main).toMatch(/createQueryClient\(\)/)
    expect(main).not.toMatch(/new QueryClient\(/)
  })
})
