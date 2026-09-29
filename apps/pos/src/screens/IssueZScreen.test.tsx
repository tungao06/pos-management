// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
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

  // Task 14 · carried item 9a (Task 16): E4 stuck (BOT_CASH_REQUIRED) offers "เก็บกะนี้ไว้ในเครื่อง" prominently.
  it('BOT_CASH_REQUIRED offers keepShiftLocal with the exact warning, then reloads as local-only', async () => {
    const api = fakeApi({
      fetchBotCash: vi.fn(async () => { throw new Error('OFFLINE: network') }),
      countSummary: vi
        .fn(async () => summary({ includesBotCash: false, bot: null }))
        .mockResolvedValueOnce(summary({ includesBotCash: false, bot: null }))
        .mockResolvedValueOnce(summary({ syncMode: 'local_only', includesBotCash: false, bot: null })),
    })
    render(<IssueZScreen shiftId="s1" countedSatang={61_500} />, { api, session })
    await user.click(await screen.findByTestId('keep-shift-local-open'))
    expect(screen.getByText(TH.keepShiftLocalWarning)).toBeVisible()
    await user.click(screen.getByTestId('approval-owner-TungAo'))
    await user.type(screen.getByTestId('approval-pin'), '1111')
    await user.type(screen.getByTestId('approval-reason'), 'E4 ล่มถาวร')
    await user.click(screen.getByTestId('approval-ok'))
    await waitFor(() => expect(api.keepShiftLocal).toHaveBeenCalledWith({ approverUserId: 'u1', approverPin: '1111', reason: 'E4 ล่มถาวร', shiftId: 's1' }))
    expect(await screen.findByTestId('count-expected')).toBeVisible() // local_only now — the count review opens
  })

  it('fix round 1 item 1: sends the bank-app total typed here too', async () => {
    const api = fakeApi()
    render(<IssueZScreen shiftId="s1" countedSatang={61_500} />, { api, session })
    await screen.findByTestId('count-expected')
    await user.type(screen.getByTestId('count-bank-qr'), '10')
    await pickOwnerAndPin('TungAo', '1111')
    await user.click(screen.getByTestId('count-confirm'))
    expect(api.issueZ).toHaveBeenCalledWith(expect.objectContaining({ bankQrTotalSatang: 1_000 }))
  })

  it('fix round 1 item 2 (+security): Z_CHAIN_BROKEN "central" warns, a second PIN acknowledges and retries', async () => {
    const issueZ = vi.fn().mockRejectedValueOnce(new Error('Z_CHAIN_BROKEN: central')).mockResolvedValueOnce({ id: 'z1', shiftId: 's1', createdAt: 'x', hash: 'h', hashOk: true, snapshot: null })
    const api = fakeApi({
      issueZ,
      bootstrap: vi.fn(async () => ({ users: [{ id: 'u1', displayName: 'TungAo', role: 'owner' }], countingShift: null, zWaiting: [], centralLastZNo: 7 })),
    })
    render(<IssueZScreen shiftId="s1" countedSatang={61_500} />, { api, session })
    await screen.findByTestId('count-expected')
    await pickOwnerAndPin('TungAo', '1111')
    await user.click(screen.getByTestId('count-confirm'))
    expect(await screen.findByText(TH.zChainCentral(7))).toBeVisible()
    await pickOwnerAndPin('TungAo', '1111')
    await user.click(screen.getByTestId('count-confirm'))
    await waitFor(() => expect(issueZ).toHaveBeenLastCalledWith(expect.objectContaining({ acknowledgeZChainBroken: true })))
  })

  it('fix round 1 item 9: zBlockedBy points at the earlier shift before any PIN is asked (ruling R7)', async () => {
    const api = fakeApi({ countSummary: vi.fn(async () => summary({ zBlockedBy: 's0' })) })
    render(<IssueZScreen shiftId="s1" countedSatang={61_500} />, { api, session })
    expect(await screen.findByTestId('count-z-blocked-go')).toBeVisible()
    expect(screen.queryByTestId('count-confirm')).toBeNull()
  })

  it('fix round 1 item 10: load.isError shows a retry button', async () => {
    const countSummary = vi.fn(async () => {
      throw new Error('SHIFT_NOT_COUNTING: s1')
    })
    const api = fakeApi({ countSummary })
    render(<IssueZScreen shiftId="s1" countedSatang={61_500} />, { api, session })
    expect(await screen.findByTestId('z-retry')).toBeVisible()
    await user.click(screen.getByTestId('z-retry'))
    await waitFor(() => expect(countSummary).toHaveBeenCalledTimes(2))
  })
})
