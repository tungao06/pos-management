// packages/dayo-mock/src/server.ts — Node only (the one src file allowed node:*). Listens on 127.0.0.1 only.
import { createServer } from 'node:http'
import { createMockDayo, type MockMode, type MockOverride } from './index.js'

const arg = (name: string): string[] => process.argv.flatMap((a, i) => (a === name ? [process.argv[i + 1] ?? ''] : []))
const port = Number(arg('--port')[0] ?? '8787')
const origins = arg('--origin')
const mock = createMockDayo(origins.length > 0 ? { origins } : {})

createServer(async (req, res) => {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const body = Buffer.concat(chunks).toString('utf8')
  const url = new URL(req.url ?? '/', `http://localhost:${port}`)
  const send = (status: number, payload: unknown): void => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload)) }
  if (url.pathname.startsWith('/__mock/')) { // test control — no auth, never shipped
    const j = body === '' ? null : (JSON.parse(body) as unknown)
    switch (url.pathname) {
      case '/__mock/reset': mock.reset(); return send(200, { ok: true })
      case '/__mock/mode': mock.setMode((j as { mode: MockMode }).mode); return send(200, { ok: true })
      case '/__mock/now': mock.setNow((j as { iso: string | null }).iso); return send(200, { ok: true })
      case '/__mock/override': mock.override(j as MockOverride); return send(200, { ok: true })
      case '/__mock/bump-catalog': return send(200, { catalog_version: mock.bumpCatalog() })
      case '/__mock/seed-orders': mock.seedCentralOrders(j as never); return send(200, { ok: true })
      case '/__mock/state': return send(200, { orders: mock.orders(), requests: mock.requests() })
      default: return send(404, { ok: false })
    }
  }
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
  const r = await mock.handle(new Request(url, { method: req.method ?? 'GET', headers, ...(body === '' || req.method === 'GET' || req.method === 'OPTIONS' ? {} : { body }) }))
  res.writeHead(r.status, Object.fromEntries(r.headers))
  res.end(Buffer.from(await r.arrayBuffer()))
}).listen(port, '127.0.0.1', () => console.log(`dayo mock on http://127.0.0.1:${port}`))
