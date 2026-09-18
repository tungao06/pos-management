export type CheckResult = { id: string; title: string; required: boolean; pass: boolean | 'manual'; detail: string }
export type SpikeReport = { vfs: string; sqliteVersion: string; bootCount: number; checks: CheckResult[] }
export type WorkerReply = { type: 'report'; report: SpikeReport } | { type: 'error'; message: string }
declare global {
  const __SPIKE_VFS__: 'opfs' | 'opfs-sahpool'
}
