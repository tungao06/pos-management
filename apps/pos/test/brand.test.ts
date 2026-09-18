import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const hexes = (text: string): string[] => [...new Set((text.match(/#[0-9a-fA-F]{6}\b/g) ?? []).map((h) => h.toUpperCase()))].sort()

describe('brand colours (D44, D50 Q3-23)', () => {
  it('the wave is orange on Deep Forest shades only — matcha stays inside the logo', () => {
    expect(hexes(read('../public/brand/wave.svg'))).toEqual(['#1E3B22', '#35613B', '#ED7A13'])
  })

  it('styles.css has no matcha or signage-yellow token and the page background is Cream', () => {
    const css = read('../src/styles.css')
    const colours = hexes(css)
    expect(colours).not.toContain('#7EA05F')
    expect(colours).not.toContain('#FFFADD')
    expect(css).toMatch(/--cream:\s*#f6f3e8;/i)
    expect(css).toMatch(/background:\s*var\(--cream\);/)
  })
})
