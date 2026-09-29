import { PosError } from './errors'

/**
 * A builder of @dayo/domain refuses (throws) a row dayo would reject forever: inside the caller's transaction that
 * rolls the whole write back — surfaced as BAD_INPUT, never as a raw RangeError/ZodError.
 */
export function builtRow<T>(what: string, build: () => T): T {
  try {
    return build()
  } catch (e) {
    if (e instanceof PosError) throw e
    throw new PosError('BAD_INPUT', `${what}: ${e instanceof Error ? e.message.slice(0, 300) : String(e)}`)
  }
}

/**
 * The later of two ISO instants. A shift's rows are stamped no earlier than its opening (dayo 0066:216-222 refuses a
 * cash row with created_at < opened_at for good): a device clock stepped back after opening moves the stamp up to the
 * opening instant instead of making the row unsendable.
 */
export function notBefore(at: string, floor: string): string {
  return Date.parse(at) < Date.parse(floor) ? floor : at
}
