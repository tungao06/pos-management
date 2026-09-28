import { defineConfig, devices } from '@playwright/test'

// http://localhost:8787/api/v1 — the address @dayo/dayo-mock's default `origins` (state.ts) already expects the
// e2e run's own preview origin to be, so nothing else about the mock needs configuring for this to work.
const DAYO_MOCK_URL = 'http://localhost:8787/api/v1'

export default defineConfig({
  testDir: 'e2e',
  testIgnore: ['**/hidden-stock/**'], // Task 16: the stock screens are unreachable — kept for a later task
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } }],
  webServer: [
    {
      // Task 17: setting the tablet up now needs a real E1 to answer — @dayo/dayo-mock's own HTTP server
      // (packages/dayo-mock/src/server.ts) stands in for dayo, with its built-in fixture (TungAo/DCm as owners).
      command: 'pnpm --filter @dayo/dayo-mock start',
      // '/' answers 404 (only /api/v1/* and /__mock/* are routed) — /__mock/state always answers 200.
      url: 'http://localhost:8787/__mock/state',
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
    },
    {
      // security M1 (fix round 1): built with `--mode e2e`, not plain `pnpm build` — `SetupScreen` only reads
      // VITE_DAYO_BASE_URL in that mode, so a normal production build never embeds this address even if the var
      // is left set in someone's shell (test/build-check.test.ts checks this for real).
      command: 'pnpm exec tsc --noEmit && pnpm exec vite build --mode e2e && pnpm exec vite preview --port 4173 --strictPort',
      url: 'http://localhost:4173',
      env: { VITE_DAYO_BASE_URL: DAYO_MOCK_URL },
      reuseExistingServer: !process.env['CI'],
      timeout: 240_000,
    },
  ],
})
