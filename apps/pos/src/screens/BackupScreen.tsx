import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState, type JSX } from 'react'
import type { ConfirmBackupInput } from '../api/types'
import { useApi } from '../app/api-context'
import { bootstrapKey, useBootstrap } from '../app/queries'
import { useSession } from '../app/session'
import { errorMessage } from '../ui/errors'
import { downloadBytes } from '../ui/save-file'
import { TH } from '../ui/th'

const DATE_TIME = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' })

/**
 * spec §11: back up the whole SQLite file to the tablet's Downloads (Q3b-6 · D52). Owners only (Q3b-13 · D53). The
 * download gives no success signal, so the backup counts only after the owner taps "บันทึกไฟล์แล้ว" (Q3b-7 · review I-4).
 */
export function BackupScreen(): JSX.Element {
  const api = useApi()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const boot = useBootstrap()
  const { user } = useSession()
  const [pending, setPending] = useState<ConfirmBackupInput | null>(null)
  const [confirmed, setConfirmed] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const backup = useMutation({
    mutationFn: () => api.exportBackup(user?.id ?? ''),
    onSuccess: (file) => {
      downloadBytes(file.fileName, file.bytes)
      setConfirmed(null)
      setPending({ actorUserId: user?.id ?? '', fileName: file.fileName, byteLength: file.bytes.byteLength, createdAt: file.createdAt, lastZId: file.lastZId })
    },
    onError: (e) => setError(errorMessage(e)),
  })
  const confirm = useMutation({
    mutationFn: (input: ConfirmBackupInput) => api.confirmBackupSaved(input),
    onSuccess: async (_done, input) => {
      setPending(null)
      setConfirmed(input.fileName)
      await queryClient.invalidateQueries({ queryKey: bootstrapKey })
    },
    onError: (e) => setError(errorMessage(e)),
  })

  const last = boot.data?.lastBackupAt ?? null
  return (
    <main className="page">
      <div className="actions">
        <button type="button" data-testid="nav-home" onClick={() => void navigate({ to: '/' })}>
          {TH.back}
        </button>
      </div>
      <h1>{TH.backupTitle}</h1>
      <p>{TH.backupHint}</p>
      <p data-testid="backup-last">{last === null ? TH.backupNever : TH.backupLast(DATE_TIME.format(new Date(last)))}</p>
      {user?.role !== 'owner' ? (
        <p role="alert" className="error" data-testid="backup-owner-only">
          {TH.backupOwnerOnly}
        </p>
      ) : (
        <>
          {error !== null && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {confirmed !== null && (
            <p className="badge" data-testid="backup-done">
              {TH.backupDone(confirmed)}
            </p>
          )}
          {pending !== null && (
            <>
              <p data-testid="backup-file">{TH.backupCheckFile(pending.fileName)}</p>
              <button
                type="button"
                className="primary"
                data-testid="backup-confirm"
                disabled={confirm.isPending}
                onClick={() => {
                  setError(null)
                  confirm.mutate(pending)
                }}
              >
                {TH.backupConfirm}
              </button>
            </>
          )}
          <button
            type="button"
            className={pending === null ? 'primary' : undefined}
            data-testid="backup-download"
            disabled={backup.isPending}
            onClick={() => {
              setError(null)
              backup.mutate()
            }}
          >
            {TH.backupNow}
          </button>
        </>
      )}
    </main>
  )
}
