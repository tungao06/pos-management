import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { createIdbSecretStore, createMemorySecretStore, maskApiKey } from '../src/sync/secret-store'

const KEY = `dayo_${'0123456789abcdef'.repeat(4)}`
describe.each([['memory', () => createMemorySecretStore()], ['indexeddb', () => createIdbSecretStore(`t-${Math.random()}`)]])('%s secret store', (_, make) => {
  it('stores, reads and clears the API key', async () => {
    const s = make()
    expect(await s.getApiKey()).toBeNull()
    await s.setApiKey(KEY)
    expect(await s.getApiKey()).toBe(KEY)
    await s.clearApiKey()
    expect(await s.getApiKey()).toBeNull()
  })
  it('refuses a value that is not a dayo key', async () => {
    await expect(make().setApiKey('dayo_short')).rejects.toThrow()
  })
})
it('shows only dayo_ and the last 4 characters (spec §7 ข้อ 1)', () => { expect(maskApiKey(KEY)).toBe('dayo_…cdef') })
