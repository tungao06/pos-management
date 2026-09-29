import { defineConfig } from 'vitest/config'
// PGlite loads a WASM Postgres on first use (seconds locally, far longer on Cloudflare's CI machine, D107).
export default defineConfig({ test: { include: ['test/**/*.test.ts'], testTimeout: 120_000, hookTimeout: 120_000 } })
