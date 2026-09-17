import { describe, expectTypeOf, it } from 'vitest'
import type { ItemKind as ContractsItemKind, MovementKind as ContractsMovementKind } from '@dayo/contracts'
import type { ItemKind as DomainItemKind, MovementKind as DomainMovementKind } from '@dayo/domain'

/**
 * Minor 3 (plan-1 final review): `MovementKind` and `ItemKind` are hand-duplicated between `@dayo/domain`
 * (plain string union) and `@dayo/contracts` (zod enum, `z.infer`'d). Nothing ties them together at compile
 * time, so a later addition to one side would compile silently while the other side drifts. This package
 * depends on both, so it is the one place that can assert they stay equal. `expectTypeOf` performs the
 * check at typecheck time (tsc), not at test runtime -- it does not need `pnpm test` to catch a drift, only
 * `pnpm typecheck`, and this file is included via excel-import's tsconfig ("include": ["src", "test"]).
 */
describe('domain/contracts enum type equivalence', () => {
  it('MovementKind matches between @dayo/domain and @dayo/contracts', () => {
    expectTypeOf<DomainMovementKind>().toEqualTypeOf<ContractsMovementKind>()
  })
  it('ItemKind matches between @dayo/domain and @dayo/contracts', () => {
    expectTypeOf<DomainItemKind>().toEqualTypeOf<ContractsItemKind>()
  })
})
