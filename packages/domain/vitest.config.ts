import { defineConfig } from 'vitest/config'

// testTimeout/hookTimeout 120s, not vitest's 5s default — the source-scanning guard tests (money-edge-guard,
// parity-support) read many files and timed out under a parallel `turbo run typecheck test` locally; Cloudflare
// Workers Builds' CI machine (D107) is slower still (see packages/excel-import/vitest.config.ts). Assertions are
// unaffected — this only moves the test framework's own timeout.
export default defineConfig({ test: { include: ['test/**/*.test.ts'], testTimeout: 120_000, hookTimeout: 120_000 } })
