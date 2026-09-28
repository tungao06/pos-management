// scripts/deploy.mjs — build/deploy of the tablet app on Workers Builds + Discord notice (D107, same flow as dayo's
// scripts/deploy.ts / ADR-0045 so both systems post 🚀 DEPLOY / ❌ DEPLOY FAILED to the same #dayo-ระบบ room).
// Run at the repo root:
//   node scripts/deploy.mjs build   → typecheck + test + build of @dayo/pos · fails = ❌ DEPLOY FAILED (@here), same exit code
//   node scripts/deploy.mjs deploy  → wrangler deploy of apps/pos/dist · ok = 🚀 DEPLOY · fails = ❌ DEPLOY FAILED
// The webhook comes from DISCORD_ALERT_WEBHOOK_URL in the Worker's "Build variables and secrets" (not set = no notice).
// Plain Node (no tsx): Workers Builds runs this before anything else is compiled.

import { spawn, execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const WORKER = 'dayo-pos'
const LABEL = 'POS'
const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url))
const APP_DIR = fileURLToPath(new URL('../apps/pos/', import.meta.url))
const TAIL_BYTES = 64 * 1024
const BLOCK_LINES = 15
const MAX_TEXT = 1800

const STEPS = {
  build: { cwd: REPO_ROOT, cmd: ['pnpm', 'turbo', 'run', 'typecheck', 'test', 'build', '--filter=@dayo/pos...'] },
  deploy: { cwd: APP_DIR, cmd: ['pnpm', 'exec', 'wrangler', 'deploy'] },
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 }).toString().trim()
  } catch {
    return ''
  }
}

function version() {
  let v = '0.0.0'
  try {
    v = JSON.parse(readFileSync(new URL('../apps/pos/package.json', import.meta.url), 'utf8')).version ?? v
  } catch {}
  const sha = (process.env.WORKERS_CI_COMMIT_SHA?.trim() || git(['rev-parse', 'HEAD'])).slice(0, 7)
  return sha ? `v${v} (${sha})` : `v${v}`
}

function branch() {
  const b = process.env.WORKERS_CI_BRANCH?.trim() || git(['rev-parse', '--abbrev-ref', 'HEAD'])
  return b === 'HEAD' ? '' : b
}

// A trimmed copy of dayo's packages/shared/src/scrub.ts: the log never leaves the build box with a secret in it.
const SCRUBBERS = [
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[ลบแล้ว]@'],
  [/(?:https?:\/\/)?(?:[a-z0-9-]+\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/[^\s"'<>)\]]+/gi, '[discord-webhook]'],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[jwt]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [ลบแล้ว]'],
  [/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, 'sb_[ลบแล้ว]'],
  [/\bdayo_[0-9a-f]{8,}/gi, 'dayo_[ลบแล้ว]'],
  [/(["']?)\b([A-Za-z0-9_-]*(?:api[_-]?key|token|secret|password|passwd))(?![A-Za-z0-9_-])\1(\s*[=:]\s*)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s&,;"'}]+)/gi, '$1$2$1$3[ลบแล้ว]'],
  [/\b[0-9a-f]{32,}\b/gi, '[hex]'],
  [/(?<![A-Za-z0-9+/=])[A-Za-z0-9+/]{100,}={0,2}(?![A-Za-z0-9+/=])/g, '[token]'],
]
const scrub = (s) => SCRUBBERS.reduce((out, [re, rep]) => out.replace(re, rep), s)
const cut = (s, n) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`)

function errorLines(output) {
  return scrub(output.replace(/\x1b\[[0-9;]*m/g, ''))
    .split(/\r?\n/)
    .filter((l) => /error|ERR!|failed|✘|×|\bFAIL\b/i.test(l))
    .map((l) => cut(l.trim(), 300).replace(/```/g, 'ˋˋˋ'))
    .slice(-BLOCK_LINES)
    .join('\n')
}

function bkkTime(at) {
  const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
  const d = new Date(at + 7 * 3_600_000)
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.toISOString().slice(11, 19)}`
}

async function notify({ ok, step, output }) {
  const url = process.env.DISCORD_ALERT_WEBHOOK_URL?.trim()
  if (!url) return
  const v = version()
  const md = (s) => scrub(s).replace(/[\\`*_~|><#[\]()]/g, '\\$&')
  const fields = []
  const subject = git(['log', '-1', '--format=%s'])
  if (subject) fields.push({ name: 'commit', value: cut(md(subject), 1024), inline: false })
  const b = branch()
  if (b) fields.push({ name: 'branch', value: cut(md(b), 1024), inline: true })
  fields.push({ name: 'เวลา', value: bkkTime(Date.now()), inline: true })
  const embed = ok
    ? { title: `🚀 DEPLOY · ${LABEL} ${v}`, color: 0x2f9e44, fields, footer: { text: `DA-YO ${v}` } }
    : {
        title: `❌ DEPLOY FAILED · ${LABEL} ${v}`,
        color: 0xa61e1e,
        description: [
          md(step),
          ...(errorLines(output) ? ['```\n' + cut(errorLines(output), MAX_TEXT - step.length) + '\n```'] : []),
          `ดู log เต็มได้ที่ Cloudflare → Workers & Pages → ${WORKER} → Deployments (Workers Builds)`,
        ].join('\n'),
        fields,
        footer: { text: `DA-YO ${v}` },
      }
  const payload = {
    username: 'DA-YO Alerts',
    ...(ok ? {} : { content: '@here' }),
    allowed_mentions: { parse: ok ? [] : ['everyone'] },
    embeds: [embed],
  }
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
    if (!res.ok) console.error(`discord notice failed: HTTP ${res.status}`)
  } catch (err) {
    console.error(`discord notice failed: ${scrub(String(err))}`)
  }
}

/** Runs the step, streams its output as usual, and keeps the tail to attach when it fails. */
function run(cmd, cwd) {
  return new Promise((resolve) => {
    const win = process.platform === 'win32'
    const child = spawn(cmd[0], cmd.slice(1), { cwd, env: process.env, shell: win })
    let tail = ''
    let trimmed = false
    const keep = (chunk, out) => {
      out.write(chunk)
      const next = tail + chunk.toString('utf8')
      trimmed ||= next.length > TAIL_BYTES
      tail = next.slice(-TAIL_BYTES)
    }
    // Cut at the front = the first line may be half a secret the scrubber cannot recognise → drop it.
    const safeTail = () => (trimmed ? tail.slice(tail.indexOf('\n') + 1) : tail)
    child.stdout.on('data', (c) => keep(c, process.stdout))
    child.stderr.on('data', (c) => keep(c, process.stderr))
    child.on('error', (err) => resolve({ code: 1, tail: `${safeTail()}\nerror: ${String(err)}` }))
    child.on('close', (code) => resolve({ code: code ?? 1, tail: safeTail() }))
  })
}

const stepName = process.argv[2]
const step = STEPS[stepName]
if (!step) {
  console.error('ใช้: node scripts/deploy.mjs build|deploy')
  process.exit(2)
}
console.log(`▶ ${stepName} ${WORKER} ${version()}`)
const { code, tail } = await run(step.cmd, step.cwd)
if (code !== 0) {
  const what = stepName === 'build' ? 'build/test ล้ม' : 'deploy ล้ม'
  await notify({ ok: false, step: `${what} (${step.cmd.slice(0, 3).join(' ')} … exit ${code})`, output: tail })
} else if (stepName === 'deploy') {
  await notify({ ok: true })
}
process.exit(code)
