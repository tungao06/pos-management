// packages/dayo-mock/src/server.ts — Node only (the one src file allowed node:*). Listens on 127.0.0.1 only.
import { createServer } from 'node:http'
import { createMockDayo, mockControl } from './index.js'

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
    const r = await mockControl(mock, url.pathname, body === '' ? null : (JSON.parse(body) as unknown))
    return send(r.status, r.body)
  }
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
  const r = await mock.handle(new Request(url, { method: req.method ?? 'GET', headers, ...(body === '' || req.method === 'GET' || req.method === 'OPTIONS' ? {} : { body }) }))
  res.writeHead(r.status, Object.fromEntries(r.headers))
  res.end(Buffer.from(await r.arrayBuffer()))
}).listen(port, '127.0.0.1', () => console.log(`dayo mock on http://127.0.0.1:${port}`))
