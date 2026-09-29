// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PosError } from '../api/errors'
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

  it('fix round 1 item 1 (D53 Q3b-12): the bank-app PromptPay total is sent when typed, null when left empty', async () => {
    const api = fakeApi()
    render(<CloseShiftScreen />, { api, session })
    await countBaht(615)
    await user.click(screen.getByTestId('count-finish'))
    await screen.findByTestId('count-expected')
    await user.type(screen.getByTestId('count-bank-qr'), '45.50')
    await pickOwnerAndPin('DCm', '2222')
    await user.click(screen.getByTestId('count-confirm'))
    expect(api.confirmCount).toHaveBeenCalledWith(expect.objectContaining({ z: expect.objectContaining({ bankQrTotalSatang: 4_550 }) }))
  })

  it('fix round 1 item 1: an unparsable bank-app total refuses to confirm (errBadInput)', async () => {
    const api = fakeApi()
    render(<CloseShiftScreen />, { api, session })
    await countBaht(615)
    await user.click(screen.getByTestId('count-finish'))
    await screen.findByTestId('count-expected')
    await user.type(screen.getByTestId('count-bank-qr'), 'abc')
    await pickOwnerAndPin('DCm', '2222')
    await user.click(screen.getByTestId('count-confirm'))
    expect(await screen.findByText(TH.errBadInput)).toBeVisible()
    expect(api.confirmCount).not.toHaveBeenCalled()
  })

  it('fix round 1 item 3: a finishCount refusal (CLOCK_AHEAD) shows while the count is still blind', async () => {
    const api = fakeApi({
      finishCount: vi.fn(async () => {
        throw new PosError('BAD_INPUT', 'CLOCK_AHEAD: นาฬิกาเครื่องล้ำเวลาจริง')
      }),
    })
    render(<CloseShiftScreen />, { api, session })
    await user.click(screen.getByTestId('count-finish'))
    expect(await screen.findByRole('alert')).toHaveTextContent('CLOCK_AHEAD')
    expect(screen.queryByTestId('count-expected')).toBeNull() // still blind — the review never opened
  })

  it('fix round 1 item 5 (security): SHIFT_CHANGED then confirming with no retype saves what is shown (0), never the stale count', async () => {
    let calls = 0
    const confirmCount = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw new Error('SHIFT_CHANGED: shown a, now b')
      return { countId: 'c1', z: { id: 'z1', shiftId: 's1', createdAt: 'x', hash: 'h', hashOk: true, snapshot: null } }
    })
    const api = fakeApi({ confirmCount })
    render(<CloseShiftScreen />, { api, session })
    await countBaht(615)
    await user.click(screen.getByTestId('count-finish'))
    await screen.findByTestId('count-expected')
    await pickOwnerAndPin('DCm', '2222')
    await user.click(screen.getByTestId('count-confirm'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(TH.errShiftChanged))
    // fix round 1 item 6 (D52): blind again — no stale expected/variance shown mid-reload
    expect(screen.queryByTestId('count-expected')).toBeNull()
    expect((screen.getByTestId('count-input-1') as HTMLInputElement).value).toBe('') // the typed count is gone

    // no retype — reveal the (unchanged) review again; ฿0 vs. the expected cash now needs a reason
    await user.click(screen.getByTestId('count-finish'))
    await screen.findByTestId('count-expected')
    expect(screen.getByTestId('count-total')).toHaveTextContent('฿0') // exactly what is shown now — not ฿615
    await pickOwnerAndPin('DCm', '2222')
    await user.type(screen.getByTestId('count-reason'), 'ยังไม่ได้นับใหม่')
    await user.click(screen.getByTestId('count-confirm'))
    await waitFor(() => expect(confirmCount).toHaveBeenCalledTimes(2))
    expect(confirmCount).toHaveBeenLastCalledWith(expect.objectContaining({ countLines: expect.arrayContaining([expect.objectContaining({ denominationSatang: 100, count: 0 })]) }))
  })

  it('fix round 2 item 1: a countSummary refusal keeps the typed count (never unmounts CountReview) and stays blind through a retry', async () => {
    let calls = 0
    const countSummary = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw new Error('SHIFT_NOT_COUNTING: s1')
      return summary()
    })
    const api = fakeApi({ countSummary })
    render(<CloseShiftScreen />, { api, session })
    await countBaht(615)
    await user.click(screen.getByTestId('count-finish'))
    expect(await screen.findByTestId('count-summary-retry')).toBeVisible()
    expect(screen.getByTestId('count-input-1')).toHaveValue('615') // the count is not lost — CountReview stays mounted
    expect(screen.queryByTestId('count-expected')).toBeNull()

    await user.click(screen.getByTestId('count-summary-retry'))
    await waitFor(() => expect(countSummary).toHaveBeenCalledTimes(2))
    // the query itself recovered, but the review must not pop open on its own — D52 (old `setShown(null)`): the
    // owner presses "นับเสร็จ" again to confirm they are looking at a real, current count.
    expect(screen.queryByTestId('count-expected')).toBeNull()

    await user.click(screen.getByTestId('count-finish'))
    expect(await screen.findByTestId('count-expected')).toBeVisible()
  })

  it('fix round 1 item 8: a non-OFFLINE fetchBotCash failure is shown, not swallowed', async () => {
    const api = fakeApi({
      fetchBotCash: vi.fn(async () => {
        throw new PosError('DAYO_BAD_RESPONSE', 'E4 422')
      }),
      countSummary: vi.fn(async () => summary({ includesBotCash: false, bot: null })),
    })
    render(<CloseShiftScreen />, { api, session })
    await countBaht(615)
    await user.click(screen.getByTestId('count-finish'))
    expect(await screen.findByTestId('count-bot-cash-error')).toHaveTextContent(TH.dayoBadResponse)
  })

  it('fix round 1 item 9: zBlockedBy shows a button to that shift’s own Z', async () => {
    const api = fakeApi({ countSummary: vi.fn(async () => summary({ zBlockedBy: 's0' })) })
    render(<CloseShiftScreen />, { api, session })
    await countBaht(615)
    await user.click(screen.getByTestId('count-finish'))
    expect(await screen.findByTestId('count-z-blocked-go')).toBeVisible()
  })
})
