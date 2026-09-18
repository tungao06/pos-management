import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
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
