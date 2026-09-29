import { defineConfig } from 'vitest/config'

// testTimeout/hookTimeout 120s — Cloudflare Workers Builds' CI machine (D107) runs this suite many times slower than a
// dev machine (see packages/excel-import/vitest.config.ts); assertions are unaffected, only vitest's own timeout moves.
export default defineConfig({ test: { include: ['test/**/*.test.ts'], testTimeout: 120_000, hookTimeout: 120_000 } })
