import { argon2idAsync } from '@noble/hashes/argon2.js'
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils.js'
import type { PinCost } from '../api/deps'
import { PosError } from '../api/errors'
import { PIN_RE } from '../api/types'

const STORED_RE = /^argon2id\$t=(\d+),m=(\d+),p=1\$([0-9a-f]{32})\$([0-9a-f]{64})$/

/** argon2id PIN hash stored as `argon2id$t=…,m=…,p=1$<salt hex>$<hash hex>` (spec §3.1, decision T8). */
export async function hashPin(pin: string, cost: PinCost): Promise<string> {
  if (!PIN_RE.test(pin)) throw new PosError('BAD_INPUT', 'PIN must be 4-6 digits')
  const salt = randomBytes(16)
  const hash = await argon2idAsync(pin, salt, { t: cost.t, m: cost.m, p: 1, dkLen: 32 })
  return `argon2id$t=${cost.t},m=${cost.m},p=1$${bytesToHex(salt)}$${bytesToHex(hash)}`
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const m = STORED_RE.exec(stored)
  if (!m) return false
  const got = await argon2idAsync(pin, hexToBytes(m[3]!), { t: Number(m[1]), m: Number(m[2]), p: 1, dkLen: 32 })
  const want = hexToBytes(m[4]!)
  let diff = 0
  for (let i = 0; i < want.length; i++) diff |= want[i]! ^ got[i]!
  return diff === 0
}
