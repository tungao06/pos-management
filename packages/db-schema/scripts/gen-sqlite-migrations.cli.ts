import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { SQLITE_MIGRATIONS_FOLDER } from '../src/migrate-sqlite.js'
import { renderMigrationsModule } from './render-sqlite-migrations.js'

const out = fileURLToPath(new URL('../src/browser/sqlite-migrations.gen.ts', import.meta.url))
writeFileSync(out, await renderMigrationsModule(SQLITE_MIGRATIONS_FOLDER), 'utf8')
console.log(`wrote ${out}`)
