// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { CentralStateDto } from '../api/types'
import { TH } from '../ui/th'
import { CentralStateChip } from './CentralStateChip'

afterEach(() => cleanup())

const BASE: CentralStateDto = { state: 'pending', orderNo: null, computedTotalSatang: null, diffSatang: null, duplicateOf: [], reason: null, voidState: 'none' }

describe('CentralStateChip (spec 04 §4.3, §6.4)', () => {
  it('pending', () => {
    render(<CentralStateChip central={BASE} />)
    expect(screen.getByTestId('central-state')).toHaveTextContent(TH.centralPending)
  })
  it('sent shows dayo\'s order number', () => {
    render(<CentralStateChip central={{ ...BASE, state: 'sent', orderNo: 'L260925-014' }} />)
    expect(screen.getByTestId('central-state')).toHaveTextContent('L260925-014')
  })
  it('problem shows dayo\'s reason', () => {
    render(<CentralStateChip central={{ ...BASE, state: 'problem', reason: 'INVALID' }} />)
    expect(screen.getByTestId('central-state')).toHaveTextContent('ส่งไม่ผ่าน: INVALID')
  })
  it('excluded', () => {
    render(<CentralStateChip central={{ ...BASE, state: 'excluded' }} />)
    expect(screen.getByTestId('central-state')).toHaveTextContent(TH.centralExcluded)
  })
  it('legacy', () => {
    render(<CentralStateChip central={{ ...BASE, state: 'legacy' }} />)
    expect(screen.getByTestId('central-state')).toHaveTextContent(TH.centralLegacy)
  })
  // review item 23: a voided bill whose order row WAS sent — dayo still counts it as a sale.
  it('adds the local-only-void chip when voidState is local_only, on top of whatever central.state is', () => {
    render(<CentralStateChip central={{ ...BASE, state: 'sent', orderNo: 'L1', voidState: 'local_only' }} />)
    expect(screen.getByTestId('central-void-local')).toHaveTextContent(TH.centralVoidLocalOnly)
  })
  it('shows no local-only-void chip otherwise', () => {
    render(<CentralStateChip central={BASE} />)
    expect(screen.queryByTestId('central-void-local')).toBeNull()
  })
})
