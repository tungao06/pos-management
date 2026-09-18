import { defineConfig } from 'drizzle-kit'
export default defineConfig({ dialect: 'postgresql', schema: './src/pg/index.ts', out: './drizzle/pg' })
