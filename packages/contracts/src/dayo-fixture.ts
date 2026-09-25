// packages/contracts/src/dayo-fixture.ts — no node:* imports (the tablet's jsdom tests load it through @dayo/dayo-mock)
import { z } from 'zod'

/** The contract fixture format of block-1 plan Task 6 (PosContractFixture). `env`/`rpc` drive dayo's harness; POS reads them to set up its mock. */
export const PosContractFixture = z.strictObject({
  name: z.string().regex(/^[a-z0-9-]+$/),
  spec: z.string(),
  env: z.record(z.string(), z.union([z.string(), z.record(z.string(), z.unknown())])),
  rpc: z.record(z.string(), z.unknown()).optional(),
  request: z.strictObject({ method: z.enum(['GET', 'POST', 'OPTIONS']), path: z.string().regex(/^\/api\/v1\//), headers: z.record(z.string(), z.string()).optional(), body: z.unknown().optional() }),
  response: z.strictObject({ status: z.number().int().min(100).max(599), headers: z.record(z.string(), z.string()).optional(), headers_absent: z.array(z.string()).optional(), body: z.unknown().optional() }),
})
export type PosContractFixture = z.infer<typeof PosContractFixture>

/**
 * The file list of block-1 plan Task 6 (docs/superpowers/plans/2026-09-25-06-block1-dayo-api.md), sorted — the ONE place
 * that names the contract fixtures (N1). Tests and the Task 23 hash check read this list; nothing counts files on its own.
 * Ruling O4 (block 2): the POS owns the fixtures until dayo builds its own set (supersedes D82 for now); they are written from
 * dayo main's SQL and handed to dayo. Adding or dropping one = change this list.
 */
export const CONTRACT_FIXTURE_NAMES = [
  'e1-catalog-changed', 'e1-catalog-unchanged', 'e1-missing-staff-scope', 'e2-envelope-invalid', 'e2-key-reused-different-content',
  'e2-missing-orders-write-scope', 'e2-order-accepted', 'e2-order-and-void-same-batch', 'e2-order-duplicate', 'e2-order-promo-closed-before-sale',
  'e2-order-sale-date-tomorrow', 'e2-receipt-conflict', 'e2-row-server-error', 'e2-unknown-code-other-row-ok', 'e2-unknown-size',
  'e2-unsupported-kind-and-field', 'e2-void-clock-ahead', 'e2-void-cross-day', 'e2-void-too-old', 'e3-orders-today', 'err-401-invalid-key',
  'err-404-api-disabled', 'err-404-unknown-path', 'err-429-rate-limited', 'err-500-rpc-unreachable', 'preflight-allowed-api-off', 'preflight-disallowed-origin',
] as const

/** Header lookup ignoring case — the fixtures write `Access-Control-Allow-Origin`, fetch lower-cases. */
export function header(h: Record<string, string> | undefined, name: string): string | undefined {
  const k = Object.keys(h ?? {}).find((x) => x.toLowerCase() === name.toLowerCase())
  return k === undefined ? undefined : h![k]
}
