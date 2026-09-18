import { describe, expect, it } from 'vitest'
import { createSerialQueue } from './serial'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('createSerialQueue', () => {
  it('never overlaps tasks and keeps call order', async () => {
    const serial = createSerialQueue()
    const log: string[] = []
    const task = (name: string, ms: number) =>
      serial(async () => {
        log.push(`start ${name}`)
        await sleep(ms)
        log.push(`end ${name}`)
        return name
      })
    expect(await Promise.all([task('a', 20), task('b', 1), task('c', 5)])).toEqual(['a', 'b', 'c'])
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c'])
  })
  it('a failing task does not block the next one', async () => {
    const serial = createSerialQueue()
    const failed = serial(async () => {
      throw new Error('boom')
    })
    const next = serial(async () => 'ok')
    await expect(failed).rejects.toThrow('boom')
    await expect(next).resolves.toBe('ok')
  })
})
