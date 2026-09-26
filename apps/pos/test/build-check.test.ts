// security M1 (fix round 1): a production build must never embed the e2e dayo-mock address, even if
// VITE_DAYO_BASE_URL happens to be left set in the shell that runs `pnpm build`. `SetupScreen` only reads that
// env var when `import.meta.env.MODE === 'e2e'`, so a default-mode build's dead code elimination drops the
// reference (and the literal string) entirely — this test builds for real and checks the output, so a future
// change that reintroduces an unconditional read fails here, not in production.
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { build } from 'vite'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const LEAK = 'localhost:8787' // the dayo-mock address (playwright.config.ts) — never allowed in a production build

describe('production build never contains the dayo-mock e2e address (security M1)', () => {
  it('dist assets have no "localhost:8787" after a default-mode build, even with VITE_DAYO_BASE_URL set', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'dayo-pos-build-check-'))
    const previous = process.env['VITE_DAYO_BASE_URL']
    process.env['VITE_DAYO_BASE_URL'] = 'http://localhost:8787/api/v1' // simulates a shell that forgot to unset it
    try {
      await build({ root: ROOT, logLevel: 'silent', build: { outDir, write: true, emptyOutDir: true } })
      const assetsDir = join(outDir, 'assets')
      const jsFiles = readdirSync(assetsDir).filter((f) => f.endsWith('.js'))
      expect(jsFiles.length).toBeGreaterThan(0)
      for (const file of jsFiles) {
        const content = readFileSync(join(assetsDir, file), 'utf8')
        expect(content).not.toContain(LEAK)
      }
    } finally {
      if (previous === undefined) delete process.env['VITE_DAYO_BASE_URL']; else process.env['VITE_DAYO_BASE_URL'] = previous
      rmSync(outDir, { recursive: true, force: true })
    }
  }, 60_000)
})
