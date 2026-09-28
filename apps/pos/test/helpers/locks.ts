/**
 * A Web Locks stand-in for the sync scheduler's `locks` seam (`request(name, { ifAvailable: true }, cb)`), one per
 * test / PosApi. Node 24 has a global `navigator.locks` shared by every test of a file (Node 22 has none): a test that
 * leaves a request hanging would hold 'dayo-push' there for the rest of the file, and every later cycle would be
 * skipped as if another tab were sending. With this, no test depends on the host's navigator.locks.
 * Same rule as the browser's ifAvailable: a name already held → the callback gets null at once; else it holds the
 * name until the callback's promise settles.
 */
export type TestLocks = {
  request(name: string, opts: { ifAvailable: true }, cb: (lock: unknown) => Promise<void>): Promise<void>
  /** The names held right now. */
  held(): string[]
}

export function createTestLocks(): TestLocks {
  const held = new Set<string>()
  return {
    async request(name, _opts, cb) {
      if (held.has(name)) return cb(null)
      held.add(name)
      try {
        return await cb({ name, mode: 'exclusive' })
      } finally {
        held.delete(name)
      }
    },
    held: () => [...held],
  }
}
