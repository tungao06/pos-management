import { defineConfig } from 'drizzle-kit'
export default defineConfig({ dialect: 'sqlite', schema: './src/sqlite/index.ts', out: './drizzle/sqlite' })
