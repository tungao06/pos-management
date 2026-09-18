import type { CheckResult, SpikeReport, WorkerReply } from './types'

// I-5: makes the spike installable, so S9 (navigator.storage.persist) is measured on a real installed PWA, not a Chrome "shortcut".
void navigator.serviceWorker?.register('/sw.js')

const statusEl = document.querySelector<HTMLDivElement>('#status')!
const resultEl = document.querySelector<HTMLPreElement>('#result')!

async function storageCheck(): Promise<CheckResult> {
  const persisted = await navigator.storage.persisted()
  const granted = persisted || (await navigator.storage.persist())
  const estimate = await navigator.storage.estimate()
  return { id: 'S9', title: 'navigator.storage.persist()', required: true, pass: granted, detail: `persisted=${persisted} granted=${granted} quota=${estimate.quota ?? '?'} usage=${estimate.usage ?? '?'}` }
}

function runWorker(): Promise<SpikeReport> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (ev: MessageEvent<WorkerReply>) => {
      if (ev.data.type === 'report') resolve(ev.data.report)
      else reject(new Error(ev.data.message))
    }
    worker.onerror = (ev) => reject(new Error(ev.message))
    worker.postMessage({ type: 'run' })
  })
}

async function main(): Promise<void> {
  const ua = navigator.userAgent
  try {
    const report = await runWorker()
    report.checks.push(await storageCheck())
    report.checks.push({ id: 'S10', title: 'data survives closing the app', required: true, pass: 'manual', detail: 'ปิดแอป (ปัดทิ้ง) หรือรีสตาร์ตเครื่อง แล้วเปิดใหม่ → bootCount ต้องเพิ่ม 1' })
    report.checks.push({ id: 'I2', title: 'second tab', required: false, pass: 'manual', detail: 'เปิด URL เดียวกันในแท็บที่ 2 → จดว่า S1 ขึ้นข้อความอะไร และแท็บแรกยังกด reload ได้ไหม' })
    const failed = report.checks.filter((c) => c.required && c.pass === false)
    const verdict = failed.length === 0 ? 'PASS' : 'FAIL'
    statusEl.textContent = `${verdict} · bootCount=${report.bootCount} · ${report.vfs}`
    statusEl.dataset['verdict'] = verdict
    statusEl.dataset['bootCount'] = String(report.bootCount)
    resultEl.textContent = JSON.stringify({ ua, ...report }, null, 2)
  } catch (e) {
    statusEl.textContent = 'FAIL'
    statusEl.dataset['verdict'] = 'FAIL'
    resultEl.textContent = JSON.stringify({ ua, error: e instanceof Error ? e.message : String(e) }, null, 2)
  }
}

void main()
