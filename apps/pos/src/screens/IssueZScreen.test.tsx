// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { render } from '../test-utils'
import { TH } from '../ui/th'
import { fakeApi, pickOwnerAndPin, summary, user } from './block3-test-fixtures'
import { IssueZScreen } from './IssueZScreen'

const session = { userId: 'u1', role: 'owner' as const }

describe('IssueZScreen (D101 step 3)', () => {
  it('fetches E4 on open, shows the real variance, the count is read-only, a reason at ≥ ฿20, then issueZ', async () => {
    const api = fakeApi() // expected ฿615.00 with bot cash; the saved count is ฿595 → −฿20.00
    render(<IssueZScreen shiftId="s1" countedSatang={59_500} />, { api, session })
    expect(await screen.findByTestId('count-expected')).toHaveTextContent('615.00')
    expect(api.fetchBotCash).toHaveBeenCalledWith('s1')
    expect(screen.queryByTestId('count-input-1')).toBeNull()
    await pickOwnerAndPin('TungAo', '1111')
    expect(screen.getByTestId('count-confirm')).toBeDisabled()
    await user.type(screen.getByTestId('count-reason'), 'ทอนผิด')
    await user.click(screen.getByTestId('count-confirm'))
    expect(api.issueZ).toHaveBeenCalledWith(expect.objectContaining({ shiftId: 's1', shownFingerprint: 'fp', varianceReason: 'ทอนผิด', approverUserId: 'u1', approverPin: '1111' }))
    expect(await screen.findByTestId('z-issued')).toBeVisible()
  })
  it('E4 fails: the error text and a retry button — no confirm button', async () => {
    const api = fakeApi({ fetchBotCash: vi.fn(async () => { throw new Error('OFFLINE: network') }), countSummary: vi.fn(async () => summary({ includesBotCash: false, bot: null })) })
    render(<IssueZScreen shiftId="s1" countedSatang={61_500} />, { api, session })
    expect(await screen.findByTestId('z-retry')).toBeVisible()
    expect(screen.queryByTestId('count-confirm')).toBeNull()
    expect(screen.getByText(TH.errBotCashRequired)).toBeVisible()
  })
})
