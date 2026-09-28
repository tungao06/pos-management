import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const APP_DIR = fileURLToPath(new URL('.', import.meta.url))

// fu app-version: apps/pos/package.json's `version` is the one number the owner bumps before a release
// (`pnpm release:version`, root package.json) — read here so `define` can inline it as a string literal.
function readPackageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version?: string }
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

// Same source Cloudflare Workers Builds gives `scripts/deploy.mjs`'s Discord notice, so the two never disagree —
// falls back to a local `git rev-parse` (dev machine), then to the literal "dev" if git itself is missing.
// Must never throw and fail the build.
function readShortCommit(): string {
  const ci = process.env['WORKERS_CI_COMMIT_SHA']?.trim()
  if (ci) return ci.slice(0, 7)
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: APP_DIR, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return 'dev'
  }
}

const APP_VERSION = readPackageVersion()
const APP_COMMIT = readShortCommit()
const APP_BUILD_TIME = new Date().toISOString()

// Support (fu app-version): `/version.json` lets anyone check the exact deploy from a URL, without opening the
// app. Not a static `public/` file — the three values above are only known at build time. `.json` is outside
// the PWA's `globPatterns` (below), so workbox never precaches it; `public/_headers` also marks it no-cache.
function versionJsonPlugin(info: { version: string; commit: string; builtAt: string }): Plugin {
  return {
    name: 'dayo-version-json',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(info) })
    },
  }
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __APP_COMMIT__: JSON.stringify(APP_COMMIT),
    __APP_BUILD_TIME__: JSON.stringify(APP_BUILD_TIME),
  },
  plugins: [
    react(),
    versionJsonPlugin({ version: APP_VERSION, commit: APP_COMMIT, builtAt: APP_BUILD_TIME }),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png', 'brand/logo-header.svg', 'brand/wave.svg'],
      manifest: {
        name: 'DA-YO POS',
        short_name: 'DA-YO',
        lang: 'th',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        // Brand D44: Cream background, Deep Forest bars.
        background_color: '#F6F3E8',
        theme_color: '#1E3B22',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,wasm,svg,png,webmanifest}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: '/index.html',
        clientsClaim: true,
        skipWaiting: true,
      },
    }),
  ],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  build: { target: 'es2022' },
  server: { port: 5173, strictPort: true },
  // Cloudflare Quick Tunnel for tablet testing (D48 Q3-2): allow *.trycloudflare.com in preview only.
  preview: { port: 4173, strictPort: true, allowedHosts: ['.trycloudflare.com'] },
})
