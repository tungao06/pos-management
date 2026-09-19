// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { useEffect, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BackupFileDto, PosApi, UserDto } from '../api/types'
import { ApiProvider } from '../app/api-context'
import { SessionProvider, useSession } from '../app/session'
import { BackupScreen } from './BackupScreen'

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}))
const downloads = vi.hoisted(() => [] as string[])
vi.mock('../ui/save-file', () => ({ downloadBytes: (name: string) => downloads.push(name) }))

afterEach(() => {
  cleanup()
  downloads.length = 0
})

const OWNER: UserDto = { id: 'u1', displayName: 'TungAo', role: 'owner' }
const STAFF: UserDto = { id: 'u9', displayName: 'พนักงาน', role: 'staff' }
const FILE: BackupFileDto = { fileName: 'dayo-pos-A-20260917-201000.sqlite3', bytes: new Uint8Array(4096), createdAt: '2026-09-17T13:10:00.000Z', lastZId: 'z-1' }

function SignedIn({ user }: { user: UserDto }): JSX.Element {
  const { signIn } = useSession()
  useEffect(() => signIn(user), [signIn, user])
  return <BackupScreen />
}

function mount(user: UserDto): PosApi {
  const api = {
    bootstrap: vi.fn(async () => ({ needsSetup: false, device: null, users: [], openShift: null, pendingSyncItems: 0, lastBackupAt: null, backupDue: true })),
    exportBackup: vi.fn(async () => FILE),
    confirmBackupSaved: vi.fn(async () => undefined),
  } as unknown as PosApi
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={api}>
        <SessionProvider>
          <SignedIn user={user} />
        </SessionProvider>
      </ApiProvider>
    </QueryClientProvider>,
  )
  return api
}

describe('BackupScreen', () => {
  it('owner: download, then the backup counts only after "บันทึกไฟล์แล้ว" (review I-4 · Q3b-7)', async () => {
    const api = mount(OWNER)
    act(() => screen.getByTestId('backup-download').click())
    await waitFor(() => expect(screen.getByTestId('backup-file').textContent).toContain(FILE.fileName))
    expect(downloads).toEqual([FILE.fileName])
    expect(api.confirmBackupSaved).not.toHaveBeenCalled()
    act(() => screen.getByTestId('backup-confirm').click())
    await waitFor(() => expect(screen.getByTestId('backup-done')).toBeTruthy())
    expect(api.confirmBackupSaved).toHaveBeenCalledWith({ actorUserId: OWNER.id, fileName: FILE.fileName, byteLength: 4096, createdAt: FILE.createdAt, lastZId: 'z-1' })
    expect(screen.queryByTestId('backup-confirm')).toBeNull()
  })

  it('staff: no download button (Q3b-13 · D53)', async () => {
    const api = mount(STAFF)
    await waitFor(() => expect(screen.getByTestId('backup-owner-only')).toBeTruthy())
    expect(screen.queryByTestId('backup-download')).toBeNull()
    expect(api.exportBackup).not.toHaveBeenCalled()
  })
})
