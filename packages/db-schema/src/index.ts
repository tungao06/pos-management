/**
 * Root entry = Node + ESM only (M13). The migrate helpers resolve the drizzle/ folders with `import.meta.url` relative
 * to src/, and the package ships .ts sources, so a CommonJS build or a bundler that relocates files breaks them.
 * Browser code imports the `./sqlite` subpath only.
 */
export * as sqlite from './sqlite/index.js'
export * as pg from './pg/index.js'
export { migrateSqlite, SQLITE_MIGRATIONS_FOLDER } from './migrate-sqlite.js'
export { migratePg, PG_MIGRATIONS_FOLDER } from './migrate-pg.js'
export { deterministicSeedId, SEED_TABLES, seedToRows, type SeedOpts, type SeedRows, type SeedTable } from './seed/rows.js'
export { applySeedSqlite, loadCatalogSqlite } from './seed/apply-sqlite.js'
export { applySeedPg, loadCatalogPg } from './seed/apply-pg.js'
