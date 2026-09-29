// packages/dayo-mock/src/server.ts — Node only (the one src file allowed node:*). Listens on 127.0.0.1 only.
import { createServer } from 'node:http'
import { createMockDayo } from './index.js'
import { serveOne } from './serve.js'

const arg = (name: string): string[] => process.argv.flatMap((a, i) => (a === name ? [process.argv[i + 1] ?? ''] : []))
const port = Number(arg('--port')[0] ?? '8787')
const origins = arg('--origin')
const flag = (name: string): boolean => process.argv.includes(name)
// --block3 = dayo phase 1 (ADR-0069, dayo main 12885fe) · --block3-phase2 = + phase 2 (preflight P3)
const mock = createMockDayo({ ...(origins.length > 0 ? { origins } : {}), block3: flag('--block3'), block3Phase2: flag('--block3-phase2') })

createServer(async (req, res) => {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
  const a = await serveOne(mock, { method: req.method ?? 'GET', url: new URL(req.url ?? '/', `http://localhost:${port}`), headers, body: Buffer.concat(chunks).toString('utf8') })
  if (a.drop) { req.socket.destroy(); return } // mode 'offline' only
  if (a.error !== undefined) console.error('dayo mock:', a.error) // a mock bug surfaces as 500 + a log line, never as "offline"
  res.writeHead(a.status, a.headers)
  res.end(Buffer.from(a.body))
}).listen(port, '127.0.0.1', () => console.log(`dayo mock on http://127.0.0.1:${port}`))
