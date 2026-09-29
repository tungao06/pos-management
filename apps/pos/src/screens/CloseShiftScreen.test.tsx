// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { render } from '../test-utils'
import { TH } from '../ui/th'
import { countBaht, fakeApi, pickOwnerAndPin, summary, user } from './block3-test-fixtures'
import { CloseShiftScreen } from './CloseShiftScreen'

const session = { userId: 'u1', role: 'owner' as const }

describe('CloseShiftScreen (D52 Q3b-3 · D101 · D102)', () => {
  it('the expected cash is hidden until "นับเสร็จ"', async () => {
    const api = fakeApi()
    render(<CloseShiftScreen />, { api, session })
    expect(screen.queryByTestId('count-expected')).toBeNull()
    await user.click(screen.getByTestId('count-finish'))
    expect(api.finishCount).toHaveBeenCalledOnce()
    expect(await screen.findByTestId('count-expected')).toHaveTextContent('615.00')
  })

  it('online: bot bills listed; a ฿20.00 shortage needs a reason; confirm sends count + Z', async () => {
    const api = fakeApi()
    render(<CloseShiftScreen />, { api, session })
    await countBaht(595)
    await user.click(screen.getByTestId('count-finish'))
    expect(await screen.findByText(TH.countBotCash(1))).toBeVisible()
    await pickOwnerAndPin('DCm', '2222')
    expect(screen.getByTestId('count-confirm')).toBeDisabled()
    await user.type(screen.getByTestId('count-reason'), 'ทอนผิด')
    await user.click(screen.getByTestId('count-confirm'))
    expect(api.confirmCount).toHaveBeenCalledWith(expect.objectContaining({ shiftId: 's1', approverUserId: 'u2', approverPin: '2222', shownFingerprint: 'fp', z: expect.objectContaining({ varianceReason: 'ทอนผิด' }) }))
  })

  it('the path follows summary.includesBotCash: bot cash already stored (e.g. after a reload, now offline) → online path, E4 not even asked (review item 1)', async () => {
    const api = fakeApi({
      fetchBotCash: vi.fn(async () => {
        throw new Error('OFFLINE: network')
      }),
    }) // countSummary says includesBotCash: true
    render(<CloseShiftScreen />, { api, session })
    await countBaht(615)
    await user.click(screen.getByTestId('count-finish'))
    expect(await screen.findByText(TH.countBotCash(1))).toBeVisible()
    expect(api.fetchBotCash).not.toHaveBeenCalled()
    expect(screen.queryByTestId('count-no-bot-cash')).toBeNull()
    await pickOwnerAndPin('DCm', '2222')
    await user.click(screen.getByTestId('count-confirm'))
    expect(api.confirmCount).toHaveBeenCalledWith(expect.objectContaining({ z: expect.objectContaining({ acknowledgeZChainBroken: false }) }))
  })

  it('offline (no stored bot cash): label "ยังไม่รวมบิลเงินสดจากบอท", no reason asked, z: null, then the waiting screen', async () => {
    const api = fakeApi({
      fetchBotCash: vi.fn(async () => {
        throw new Error('OFFLINE: network')
      }),
      countSummary: vi.fn(async () => summary({ includesBotCash: false, bot: null, expectedCashSatang: 54_500 })),
    })
    render(<CloseShiftScreen />, { api, session })
    await countBaht(615)
    await user.click(screen.getByTestId('count-finish'))
    expect(await screen.findByTestId('count-no-bot-cash')).toHaveTextContent(TH.countNoBotCash)
    expect(screen.queryByTestId('count-reason')).toBeNull()
    await pickOwnerAndPin('DCm', '2222')
    await user.click(screen.getByTestId('count-confirm'))
    expect(api.confirmCount).toHaveBeenCalledWith(expect.objectContaining({ z: null }))
    expect(await screen.findByText(TH.countSavedOffline)).toBeVisible()
  })

  it('a local-only shift: no E4 call, no bot line, no offline label, the Z right away (ruling R6)', async () => {
    const api = fakeApi({
      countSummary: vi.fn(async () => summary({ syncMode: 'local_only', includesBotCash: false, bot: null, expectedCashSatang: 54_500, cash: { ...summary().cash, botCashSatang: 0 } })),
    })
    render(<CloseShiftScreen />, { api, session })
    await countBaht(545)
    await user.click(screen.getByTestId('count-finish'))
    await screen.findByTestId('count-expected')
    expect(api.fetchBotCash).not.toHaveBeenCalled()
    expect(screen.queryByTestId('count-no-bot-cash')).toBeNull()
    expect(screen.queryByText(TH.countBotCash(1))).toBeNull()
    await pickOwnerAndPin('DCm', '2222')
    await user.click(screen.getByTestId('count-confirm'))
    expect(api.confirmCount).toHaveBeenCalledWith(expect.objectContaining({ z: expect.objectContaining({ varianceReason: null }) }))
  })

  it('Z_CHAIN_BROKEN "central": explains the central Z number, asks the PIN again, retries with the acknowledgement', async () => {
    const confirmCount = vi.fn().mockRejectedValueOnce(new Error('Z_CHAIN_BROKEN: central')).mockResolvedValueOnce({ countId: 'c1', z: null })
    const api = fakeApi({
      confirmCount,
      bootstrap: vi.fn(async () => ({ users: [{ id: 'u1', displayName: 'TungAo', role: 'owner' }, { id: 'u2', displayName: 'DCm', role: 'owner' }], countingShift: null, zWaiting: [], centralLastZNo: 41 })),
    })
    render(<CloseShiftScreen />, { api, session })
    await countBaht(615)
    await user.click(screen.getByTestId('count-finish'))
    await screen.findByTestId('count-expected')
    await pickOwnerAndPin('DCm', '2222')
    await user.click(screen.getByTestId('count-confirm'))
    expect(await screen.findByText(TH.zChainCentral(41))).toBeVisible()
    await pickOwnerAndPin('DCm', '2222')
    await user.click(screen.getByTestId('count-confirm'))
    await waitFor(() => expect(confirmCount).toHaveBeenLastCalledWith(expect.objectContaining({ z: expect.objectContaining({ acknowledgeZChainBroken: true }) })))
  })
})
