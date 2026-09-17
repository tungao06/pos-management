import { defineConfig } from 'vitest/config'
// PGlite loads a WASM Postgres on first use, which can take several seconds.
export default defineConfig({ test: { include: ['test/**/*.test.ts'], testTimeout: 30_000, hookTimeout: 30_000 } })
