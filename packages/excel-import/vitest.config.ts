import { defineConfig } from 'vitest/config'

// testTimeout/hookTimeout 120s, not vitest's 5s default — Cloudflare Workers Builds' CI machine (D107) is far
// slower than a dev machine (a full run here took ~2s locally vs 45–62s there for the same 8 files/33 tests),
// and a DIFFERENT test timed out on each of two consecutive builds, so a per-test override is whack-a-mole;
// a generous package-wide ceiling is the real fix. 120s is enormous headroom against the whole suite's own
// measured 61.6s there. Assertions themselves are unaffected — this only moves the test framework's own
// timeout (spec §8 never loosens the ±1 satang ceiling).
// (Tried isolate:false + pool:'threads' to also cut down loadFixture()'s repeated xlsx parse across the 7
// files that call it — measured no actual sharing benefit even so, each file still parses its own copy, so
// dropped it rather than carry pool/isolate's other behavioral risk for no proven gain.)
export default defineConfig({ test: { include: ['test/**/*.test.ts'], testTimeout: 120_000, hookTimeout: 120_000 } })
