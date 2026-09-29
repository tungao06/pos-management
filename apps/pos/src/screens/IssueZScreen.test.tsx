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
    // the count was saved offline (no bot cash yet); E4 answers → expected ฿615.00 with bot cash; the saved count is ฿595 → −฿20.00
    const countSummary = vi.fn(async () => summary()).mockResolvedValueOnce(summary({ includesBotCash: false, bot: null }))
    const api = fakeApi({ countSummary })
    render(<IssueZScreen shiftId="s1" countedSatang={59_500} />, { api, session })
    expect(await screen.findByTestId('count-expected')).toHaveTextContent('615.00')
    expect(api.fetchBotCash).toHaveBeenCalledWith('s1')
    expect(countSummary).toHaveBeenCalledTimes(2) // read first, E4, then read again with the bot cash in
    expect(screen.queryByTestId('count-input-1')).toBeNull()
    await pickOwnerAndPin('TungAo', '1111')
    expect(screen.getByTestId('count-confirm')).toBeDisabled()
    await user.type(screen.getByTestId('count-reason'), 'ทอนผิด')
    await user.click(screen.getByTestId('count-confirm'))
    expect(api.issueZ).toHaveBeenCalledWith(expect.objectContaining({ shiftId: 's1', shownFingerprint: 'fp', varianceReason: 'ทอนผิด', approverUserId: 'u1', approverPin: '1111' }))
    expect(await screen.findByTestId('z-issued')).toBeVisible()
  })
  // final fix C1: the same rule as CloseShiftScreen — E4 only for a central shift whose stored answer does not cover this
  // count yet. A local-only shift (after keepShiftLocal) has no bot cash: fetchBotCash would refuse it ("a local-only shift
  // has no bot cash") and paint a red error box on every local-only Z.
  it('a local-only shift never calls E4 and shows no error — straight to the count review', async () => {
    const fetchBotCash = vi.fn(async () => { throw new Error('BAD_INPUT: a local-only shift has no bot cash') })
    const api = fakeApi({ fetchBotCash, countSummary: vi.fn(async () => summary({ syncMode: 'local_only', includesBotCash: false, bot: null })) })
    render(<IssueZScreen shiftId="s1" countedSatang={54_500} />, { api, session })
    expect(await screen.findByTestId('count-expected')).toBeVisible()
    expect(fetchBotCash).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByTestId('z-retry')).toBeNull()
    expect(screen.getByTestId('count-confirm')).toBeVisible()
  })
  it('a central shift whose stored E4 answer already covers the count reads it once, with no second E4 call', async () => {
    const countSummary = vi.fn(async () => summary())
    const api = fakeApi({ countSummary })
    render(<IssueZScreen shiftId="s1" countedSatang={61_500} />, { api, session })
    expect(await screen.findByTestId('count-expected')).toHaveTextContent('615.00')
    expect(api.fetchBotCash).not.toHaveBeenCalled()
    expect(countSummary).toHaveBeenCalledTimes(1)
  })
  it('E4 fails: the error text and a retry button — no confirm button', async () => {
    const api = fakeApi({ fetchBotCash: vi.fn(async () => { throw new Error('OFFLINE: network') }), countSummary: vi.fn(async () => summary({ includesBotCash: false, bot: null })) })
    render(<IssueZScreen shiftId="s1" countedSatang={61_500} />, { api, session })
    expect(await screen.findByTestId('z-retry')).toBeVisible()
    expect(screen.queryByTestId('count-confirm')).toBeNull()
    expect(screen.getByText(TH.errBotCashRequired)).toBeVisible()
  })

  // fix round 1 item 1a/1b: E4 actually answered with a refusal (not a plain OFFLINE) — "เก็บกะนี้ไว้ในเครื่อง" is
  // the prominent banner button; irreversible is in the warning text (item 1c).
  it('BOT_CASH_REQUIRED with a real E4 refusal offers keepShiftLocal prominently, then reloads as local-only', async () => {
    const api = fakeApi({
      fetchBotCash: vi.fn(async () => { throw new Error('DAYO_BAD_RESPONSE: unreadable') }),
      countSummary: vi
        .fn(async () => summary({ includesBotCash: false, bot: null }))
        .mockResolvedValueOnce(summary({ includesBotCash: false, bot: null }))
        .mockResolvedValueOnce(summary({ syncMode: 'local_only', includesBotCash: false, bot: null })),
    })
    render(<IssueZScreen shiftId="s1" countedSatang={61_500} />, { api, session })
    await user.click(await screen.findByTestId('keep-shift-local-open'))
    expect(screen.getByText(TH.keepShiftLocalWarning)).toBeVisible()
    expect(screen.getByText(TH.keepShiftLocalWarning)).toHaveTextContent('ย้อนกลับไม่ได้')
    await user.click(screen.getByTestId('approval-owner-TungAo'))
    await user.type(screen.getByTestId('approval-pin'), '1111')
    await user.type(screen.getByTestId('approval-reason'), 'E4 ล่มถาวร')
    await user.click(screen.getByTestId('approval-ok'))
    await waitFor(() => expect(api.keepShiftLocal).toHaveBeenCalledWith({ approverUserId: 'u1', approverPin: '1111', reason: 'E4 ล่มถาวร', shiftId: 's1' }))
    expect(await screen.findByTestId('count-expected')).toBeVisible() // local_only now — the count review opens
  })

  // fix round 1 item 1b/1d: a plain OFFLINE (no answer yet, network may still come back) gets only the small
  // secondary link, with the "wait for the network first" hint — never the prominent banner button.
  it('BOT_CASH_REQUIRED from a plain OFFLINE shows only the secondary keepShiftLocal link', async () => {
    const api = fakeApi({ fetchBotCash: vi.fn(async () => { throw new Error('OFFLINE: network') }), countSummary: vi.fn(async () => summary({ includesBotCash: false, bot: null })) })
    render(<IssueZScreen shiftId="s1" countedSatang={61_500} />, { api, session })
    expect(await screen.findByTestId('keep-shift-local-link')).toHaveTextContent(TH.keepShiftLocalSecondaryLink)
    expect(screen.getByTestId('keep-shift-local-offline-hint')).toHaveTextContent(TH.keepShiftLocalOfflineHint)
    expect(screen.queryByTestId('keep-shift-local-open')).toBeNull()
  })

  // fix round 1 item 1a · fix round 2 item C: every allowlisted reason issueZ itself refused for good also offers
  // keepShiftLocal, prominently.
  it.each([
    ['DAYO_BAD_RESPONSE', 'unreadable'],
    ['Z_TOO_LARGE', 'too many rows'],
    ['BAD_INPUT', 'COUNT_BEFORE_CENTRAL_Z: การนับนี้เกิดก่อน Z ล่าสุด'],
    ['BAD_INPUT', 'E2 shift_close row: closedAt must be after countedAt'],
    ['BAD_INPUT', 'E2 cash_count row: countedAt must be after openedAt'],
    ['BAD_INPUT', 'Z_BUILD: closedAt must be after countedAt'],
  ] as const)('issueZ refused %s shows keepShiftLocal prominently', async (code, detail) => {
    const issueZ = vi.fn(async () => { throw new Error(`${code}: ${detail}`) })
    const api = fakeApi({ issueZ })
    render(<IssueZScreen shiftId="s1" countedSatang={59_500} />, { api, session })
    await screen.findByTestId('count-expected')
    await pickOwnerAndPin('TungAo', '1111')
    await user.type(screen.getByTestId('count-reason'), 'x')
    await user.click(screen.getByTestId('count-confirm'))
    expect(await screen.findByTestId('keep-shift-local-open')).toBeVisible()
  })

  // fix round 2 item C: an ALLOWLIST, never "any BAD_INPUT" — an ordinary input mistake never shows keepShiftLocal.
  it.each([
    ['BAD_INPUT', 'unknown or inactive user nobody'],
    ['BAD_INPUT', 'a reason must be plain text (no control characters)'],
    ['BAD_INPUT', 'countLines has an invalid denomination'],
  ] as const)('issueZ refused %s does NOT show keepShiftLocal (not an allowlisted prefix)', async (code, detail) => {
    const issueZ = vi.fn(async () => { throw new Error(`${code}: ${detail}`) })
    const api = fakeApi({ issueZ })
    render(<IssueZScreen shiftId="s1" countedSatang={59_500} />, { api, session })
    await screen.findByTestId('count-expected')
    await pickOwnerAndPin('TungAo', '1111')
    await user.type(screen.getByTestId('count-reason'), 'x')
    await user.click(screen.getByTestId('count-confirm'))
    await screen.findByRole('alert') // the error itself still shows
    expect(screen.queryByTestId('keep-shift-local-open')).toBeNull()
  })

  // fix round 2 item D: a shift already local_only has nothing left for keepShiftLocal to do — never shown even
  // for an otherwise-allowlisted code.
  it('issueZ refused with an allowlisted code on an already local_only shift shows neither escape', async () => {
    const issueZ = vi.fn(async () => { throw new Error('Z_TOO_LARGE: too many rows') })
    const api = fakeApi({ issueZ, countSummary: vi.fn(async () => summary({ syncMode: 'local_only', includesBotCash: false, bot: null })) })
    render(<IssueZScreen shiftId="s1" countedSatang={59_500} />, { api, session })
    await screen.findByTestId('count-expected')
    await pickOwnerAndPin('TungAo', '1111')
    await user.type(screen.getByTestId('count-reason'), 'x')
    await user.click(screen.getByTestId('count-confirm'))
    await screen.findByRole('alert')
    expect(screen.queryByTestId('keep-shift-local-open')).toBeNull()
    expect(screen.queryByTestId('keep-shift-local-link')).toBeNull()
  })

  // fix round 2 item B: every recoverable E4 answer (try again later / fix the key) stays the secondary link.
  it.each(['DAYO_UNREACHABLE', 'DAYO_BAD_KEY', 'DAYO_KEY_NO_SCOPE', 'DAYO_API_DISABLED'] as const)(
    'E4 refused %s (recoverable) shows only the secondary keepShiftLocal link',
    async (code) => {
      const api = fakeApi({ fetchBotCash: vi.fn(async () => { throw new Error(`${code}: x`) }), countSummary: vi.fn(async () => summary({ includesBotCash: false, bot: null })) })
      render(<IssueZScreen shiftId="s1" countedSatang={61_500} />, { api, session })
      expect(await screen.findByTestId('keep-shift-local-link')).toBeVisible()
      expect(screen.queryByTestId('keep-shift-local-open')).toBeNull()
    },
  )
  it('E4 refused with the CLOCK_AHEAD of assertWindowClosed (recoverable) shows only the secondary link', async () => {
    const api = fakeApi({
      fetchBotCash: vi.fn(async () => { throw new Error('BAD_INPUT: CLOCK_AHEAD: เวลานับเงินยังไม่ถึงในระบบกลาง') }),
      countSummary: vi.fn(async () => summary({ includesBotCash: false, bot: null })),
    })
    render(<IssueZScreen shiftId="s1" countedSatang={61_500} />, { api, session })
    expect(await screen.findByTestId('keep-shift-local-link')).toBeVisible()
    expect(screen.queryByTestId('keep-shift-local-open')).toBeNull()
  })

  // fix round 3 item 2: prominent must come from the SAME allowlist `issueZ` uses (`isCentralZBlockedError`), not
  // "not recoverable" — an unknown E4 error (a plain Error, SHIFT_NOT_COUNTING, the worker down, …) is not proof
  // of a permanent block either, so it stays the secondary link too.
  it('E4 refused with an unknown error (neither allowlisted nor recoverable) shows only the secondary link', async () => {
    const api = fakeApi({
      fetchBotCash: vi.fn(async () => { throw new Error('SHIFT_NOT_COUNTING: s1') }),
      countSummary: vi.fn(async () => summary({ includesBotCash: false, bot: null })),
    })
    render(<IssueZScreen shiftId="s1" countedSatang={61_500} />, { api, session })
    expect(await screen.findByTestId('keep-shift-local-link')).toBeVisible()
    expect(screen.queryByTestId('keep-shift-local-open')).toBeNull()
  })

  // fix round 2 item A (High) · fix round 3 item 1: a wrong PIN in keepShiftLocal must show, not disappear
  // because reset() ran — and it must show again after a SECOND wrong PIN (the exact same Thai string twice),
  // clearing the field both times, with no PIN left in the mutation cache either time.
  it('a wrong PIN in keepShiftLocal shows an error twice in a row, clearing the PIN field each time', async () => {
    const api = fakeApi({
      keepShiftLocal: vi.fn(async () => { throw new Error('PIN_WRONG: nope') }),
      fetchBotCash: vi.fn(async () => { throw new Error('DAYO_BAD_RESPONSE: unreadable') }),
      countSummary: vi.fn(async () => summary({ includesBotCash: false, bot: null })),
    })
    const { queryClient } = render(<IssueZScreen shiftId="s1" countedSatang={61_500} />, { api, session })
    await user.click(await screen.findByTestId('keep-shift-local-open'))
    await user.click(screen.getByTestId('approval-owner-TungAo'))
    await user.type(screen.getByTestId('approval-reason'), 'x')
    for (let attempt = 0; attempt < 2; attempt++) {
      await user.type(screen.getByTestId('approval-pin'), '9999')
      await user.click(screen.getByTestId('approval-ok'))
      expect(await screen.findByText(TH.errPinWrong)).toBeVisible()
      expect(screen.getByTestId('approval-pin')).toHaveValue('')
      // no mutation in the cache ever keeps this PIN.
      await waitFor(() =>
        expect(queryClient.getMutationCache().getAll().some((m) => (m.state.variables as { approverPin?: string } | undefined)?.approverPin === '9999')).toBe(false),
      )
    }
  })

  // fix round 1 item 3: issueZ refused with CLOCK_AHEAD offers skipCountFloor, same as CloseShiftScreen.
  it('issueZ refused CLOCK_AHEAD offers skipCountFloor and lists the skipped counts after', async () => {
    const issueZ = vi.fn(async () => { throw new Error('BAD_INPUT: CLOCK_AHEAD: นาฬิกาเครื่องล้ำเวลาจริง') })
    const api = fakeApi({ issueZ })
    render(<IssueZScreen shiftId="s1" countedSatang={59_500} />, { api, session })
    await screen.findByTestId('count-expected')
    await pickOwnerAndPin('TungAo', '1111')
    await user.type(screen.getByTestId('count-reason'), 'x')
    await user.click(screen.getByTestId('count-confirm'))
    await user.click(await screen.findByTestId('skip-count-floor-open'))
    expect(screen.getByText(TH.skipCountFloorWarning)).toBeVisible()
    await user.click(screen.getByTestId('approval-owner-DCm'))
    await user.type(screen.getByTestId('approval-pin'), '2222')
    await user.type(screen.getByTestId('approval-reason'), 'นาฬิกาผิด')
    await user.click(screen.getByTestId('approval-ok'))
    expect(await screen.findByTestId('skip-count-floor-done')).toHaveTextContent(TH.skipCountFloorDone(1))
    expect(screen.queryByTestId('skip-count-floor-open')).toBeNull()
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
