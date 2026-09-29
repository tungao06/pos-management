import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // fu app-version: the same globals vite.config.ts's `define` injects at build time — a fixed value here so
  // src/lib/app-version.ts can be imported by any test without a real build having run.
  define: {
    __APP_VERSION__: JSON.stringify('0.0.0-test'),
    __APP_COMMIT__: JSON.stringify('testsha'),
    __APP_BUILD_TIME__: JSON.stringify('2026-01-01T00:00:00.000Z'),
  },
  plugins: [react()],
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 120_000, // Cloudflare's CI machine (D107) is far slower than a dev machine
    hookTimeout: 120_000,
  },
})
