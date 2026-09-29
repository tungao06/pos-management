/**
 * Plan 10 T1 fix round 1: consumers type-check the vendored engine through emitted .d.ts only. src/vendor is dayo's code
 * and compiles under dayo's flags (this package's tsconfig: exactOptionalPropertyTypes off); a consumer compiling the .ts
 * source under its own strict flags would fail on code nobody here may edit. Runtime/vitest/Vite still load the source.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = join(ROOT, '..', '..')
const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T
const pkg = readJson<{ exports: Record<string, unknown>; scripts: Record<string, string> }>(join(ROOT, 'package.json'))
const buildCfg = readJson<{ extends?: string; include?: string[]; compilerOptions: Record<string, unknown> }>(join(ROOT, 'tsconfig.build.json'))

const out = mkdtempSync(join(tmpdir(), 'dayo-pricing-dts-'))
afterAll(() => rmSync(out, { recursive: true, force: true }))

describe('dayo-pricing publishes types as .d.ts (T1 fix round 1)', () => {
  it('exports ".": "types" first (TypeScript picks the first matching condition), then the .ts source for runtime', () => {
    const dot = pkg.exports['.'] as Record<string, string>
    expect(Object.keys(dot)).toEqual(['types', 'default'])
    expect(dot['default']).toBe('./src/index.ts')
    expect(dot['types']).toBe('./dist/types/index.d.ts')
  })
  it('build:types runs tsc on tsconfig.build.json: declarations only, src only, into dist/types, with this package\'s flags', () => {
    expect(pkg.scripts['build:types']).toBe('tsc -p tsconfig.build.json')
    expect(buildCfg.extends).toBe('./tsconfig.json')
    expect(buildCfg.include).toEqual(['src'])
    expect(buildCfg.compilerOptions).toMatchObject({ noEmit: false, declaration: true, emitDeclarationOnly: true, rootDir: 'src', outDir: 'dist/types' })
  })
  it('the emitted declarations exist where "types" points, cover every source file, and need no Node/DOM types', () => {
    const tsc = createRequire(join(ROOT, 'package.json')).resolve('typescript/bin/tsc')
    execFileSync(process.execPath, [tsc, '-p', join(ROOT, 'tsconfig.build.json'), '--outDir', out], { stdio: 'pipe' })
    const typesPath = (pkg.exports['.'] as Record<string, string>)['types']!
    expect(existsSync(join(out, relative('dist/types', typesPath)))).toBe(true)
    const emitted = readdirSync(join(out, 'vendor')).sort()
    expect(emitted).toEqual(readdirSync(join(ROOT, 'src', 'vendor')).map((f) => f.replace(/\.ts$/, '.d.ts')).sort())
    for (const f of ['index.d.ts', ...emitted.map((e) => join('vendor', e))]) {
      const text = readFileSync(join(out, f), 'utf8')
      expect(text, f).not.toMatch(/reference types=|TextEncoder/)
    }
  })
})

describe('turbo runs build:types before anything that type-checks a dependent package', () => {
  const turbo = readJson<{ tasks: Record<string, { dependsOn?: string[]; outputs?: string[] }> }>(join(REPO, 'turbo.json'))
  it('build:types caches dist/types and chains through packages without the script (db-schema → domain → dayo-pricing)', () => {
    expect(turbo.tasks['build:types']).toEqual({ dependsOn: ['^build:types'], outputs: ['dist/types/**'] })
  })
  for (const task of ['typecheck', 'test', 'build']) {
    it(`${task} depends on ^build:types`, () => expect(turbo.tasks[task]?.dependsOn).toContain('^build:types'))
  }
  it('pos e2e (run outside turbo by CI) builds the types first — its web server runs tsc before vite build', () => {
    const pos = readJson<{ scripts: Record<string, string> }>(join(REPO, 'apps', 'pos', 'package.json'))
    expect(pos.scripts['e2e']).toMatch(/^turbo run build:types --filter=@dayo\/pos\.\.\. && /)
  })
  it('a change of tsconfig.base.json re-runs build:types / typecheck (it is a global dependency of every task hash)', () => {
    expect(readJson<{ globalDependencies?: string[] }>(join(REPO, 'turbo.json')).globalDependencies).toContain('tsconfig.base.json')
  })
  it('vendor:update rebuilds dist/types right after re-vendoring (stale .d.ts would type-check against the old engine)', () => {
    const script = readFileSync(join(ROOT, 'scripts', 'vendor.ts'), 'utf8')
    const branch = script.slice(script.indexOf("cmd === 'update'"), script.indexOf("cmd === 'drift'"))
    expect(branch).toMatch(/updateVendor\([\s\S]*pnpm run build:types/)
  })
  it('dist/ is git-ignored', () => {
    expect(readFileSync(join(REPO, '.gitignore'), 'utf8').split(/\r?\n/)).toContain('dist/')
  })
})
