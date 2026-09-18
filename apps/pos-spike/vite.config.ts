import { defineConfig } from 'vite'

// SPIKE_VFS=opfs → fallback F1: the classic OPFS VFS needs cross-origin isolation headers.
const coi = process.env['SPIKE_VFS'] === 'opfs'
const headers: Record<string, string> = coi
  ? { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }
  : {}

export default defineConfig({
  define: { __SPIKE_VFS__: JSON.stringify(coi ? 'opfs' : 'opfs-sahpool') },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  build: { target: 'es2022' },
  server: { port: 5180, strictPort: true, headers },
  // Cloudflare Quick Tunnel for tablet testing (D48 Q3-2): allow *.trycloudflare.com in preview only.
  preview: { port: 4180, strictPort: true, headers, allowedHosts: ['.trycloudflare.com'] },
})
