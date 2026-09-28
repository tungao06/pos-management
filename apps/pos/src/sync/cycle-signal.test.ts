import { afterEach, describe, expect, it, vi } from 'vitest'
import { closeSyncCycleNotifier, notifySyncCycleDone, onSyncCycleDone, SYNC_CYCLE_CHANNEL } from './cycle-signal'

afterEach(() => {
  closeSyncCycleNotifier()
  vi.unstubAllGlobals()
})

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 20))

describe('the "a sync cycle ran" signal (Task 21 hotfix 2)', () => {
  it('a notify from one side reaches every subscriber on the channel, once per notify', async () => {
    const got: number[] = []
    const offA = onSyncCycleDone(() => got.push(1))
    const offB = onSyncCycleDone(() => got.push(2))
    notifySyncCycleDone()
    await vi.waitFor(() => expect(got.sort()).toEqual([1, 2]))
    notifySyncCycleDone()
    await vi.waitFor(() => expect(got).toHaveLength(4))
    offA()
    offB()
  })
  it('it is a plain BroadcastChannel of this name — what the worker posts, the window hears', async () => {
    const heard = vi.fn()
    const window = new BroadcastChannel(SYNC_CYCLE_CHANNEL)
    window.onmessage = heard
    notifySyncCycleDone()
    await vi.waitFor(() => expect(heard).toHaveBeenCalledTimes(1))
    window.close()
  })
  it('after unsubscribe the callback is not called any more', async () => {
    const cb = vi.fn()
    const probe = vi.fn()
    const off = onSyncCycleDone(cb)
    off()
    const offProbe = onSyncCycleDone(probe) // proves the message was delivered to the channel that is still open
    notifySyncCycleDone()
    await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(1))
    await tick()
    expect(cb).not.toHaveBeenCalled()
    offProbe()
  })
  it('without BroadcastChannel both sides are silent no-ops (never throw)', () => {
    vi.stubGlobal('BroadcastChannel', undefined)
    const cb = vi.fn()
    const off = onSyncCycleDone(cb)
    expect(() => notifySyncCycleDone()).not.toThrow()
    expect(() => off()).not.toThrow()
    expect(cb).not.toHaveBeenCalled()
  })
  it('a channel that throws on post never makes notify throw', () => {
    class Broken {
      onmessage: unknown = null
      postMessage(): void { throw new Error('DataCloneError') }
      close(): void { /* nothing */ }
    }
    vi.stubGlobal('BroadcastChannel', Broken)
    expect(() => notifySyncCycleDone()).not.toThrow()
  })
})
