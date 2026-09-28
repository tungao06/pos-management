/**
 * Task 21 hotfix 2: the sync scheduler runs inside the Web Worker (db/worker.ts), so a BACKGROUND cycle — woken by
 * 'online', the minute tick or a debounced save, with nobody clicking on the main thread — had no way to tell the
 * screens it ran: the "ยังไม่ส่ง N" badge and the banners waited for the next 30 s bootstrap poll. The worker posts one
 * message on this same-origin channel after every cycle; the main thread (useSyncCycleSignal) refetches at once. The
 * 30 s poll stays as the fallback for a lost message. A message carries no data — "a cycle ran, re-read" is all it says.
 *
 * Where `BroadcastChannel` does not exist, both sides do nothing (same guard style as the scheduler's `navigator.locks`).
 */
export const SYNC_CYCLE_CHANNEL = 'dayo-pos-sync-cycle'

type ChannelCtor = new (name: string) => BroadcastChannel
const channelCtor = (): ChannelCtor | undefined => (globalThis as { BroadcastChannel?: ChannelCtor }).BroadcastChannel

/** One sender per realm (the worker), opened on first use and kept: a message is never posted on a channel being closed. */
let sender: BroadcastChannel | null = null

/** Worker side: "a sync cycle just ran; things may have changed". Never throws. */
export function notifySyncCycleDone(): void {
  const Ctor = channelCtor()
  if (Ctor === undefined) return
  try {
    sender ??= new Ctor(SYNC_CYCLE_CHANNEL)
    sender.postMessage('cycle-done')
  } catch {
    /* a signal lost here is caught up by the 30 s bootstrap poll */
  }
}

/** Closes the sender opened by notifySyncCycleDone (tests: so no open channel outlives the file). */
export function closeSyncCycleNotifier(): void {
  sender?.close()
  sender = null
}

/** Main-thread side: calls `cb` on every cycle the worker reports. Returns the unsubscribe. */
export function onSyncCycleDone(cb: () => void): () => void {
  const Ctor = channelCtor()
  if (Ctor === undefined) return () => undefined
  let channel: BroadcastChannel
  try {
    channel = new Ctor(SYNC_CYCLE_CHANNEL)
  } catch {
    return () => undefined
  }
  channel.onmessage = () => cb()
  return () => channel.close()
}
