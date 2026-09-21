// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadBytes } from './save-file'

describe('downloadBytes', () => {
  afterEach(() => vi.restoreAllMocks())

  it('clicks a temporary <a download> pointing at a blob of the bytes', async () => {
    const created: Blob[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      created.push(b as Blob)
      return 'blob:test'
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const clicked: { download: string; href: string }[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ download: this.download, href: this.href })
    })
    downloadBytes('dayo-pos-A-20260917-201000.sqlite3', new Uint8Array([83, 81, 76]))
    expect(clicked).toEqual([{ download: 'dayo-pos-A-20260917-201000.sqlite3', href: 'blob:test' }])
    expect(created).toHaveLength(1)
    expect(new Uint8Array(await created[0]!.arrayBuffer())).toEqual(new Uint8Array([83, 81, 76]))
    expect(document.querySelectorAll('a')).toHaveLength(0) // removed again
  })
})
