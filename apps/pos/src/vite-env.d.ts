/// <reference types="vite/client" />

// Injected by `define` in vite.config.ts (production build) and vitest.config.ts (tests) — a literal
// string substitution at build time, never computed at runtime (fu: app-version).
declare const __APP_VERSION__: string
declare const __APP_COMMIT__: string
declare const __APP_BUILD_TIME__: string
