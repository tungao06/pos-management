import { useMutation } from '@tanstack/react-query'
import { useRef, useState, type JSX } from 'react'
import type { DayoProbe } from '../api/types'
import { useApi } from '../app/api-context'
import { errorMessage } from '../ui/errors'
import { qrScanSupported, scanQrOnce } from '../ui/qr-scan'
import { TH } from '../ui/th'

export type ConnectFieldsValue = { baseUrl: string; apiKey: string }

/**
 * The address + key + "ทดสอบกุญแจ" (+ scan) fields spec 04 §7 ข้อ 1 puts on every screen that talks to dayo's E1:
 * first setup, a legacy device's link, and owner recovery (Task 20 reuses it for "เปลี่ยนกุญแจ"). The parent owns
 * the typed value and what happens once E1 accepts it (`onProbed`); this component owns only the probe call, its
 * error, and the "เชื่อมกับ: <ชื่อเครื่อง>" / pricing-mismatch result of the last successful one.
 *
 * R1 (security, controller ruling, Task 17): `lockBaseUrl` makes the address field read-only — recovery and a key
 * swap may only ever target the central address already stored on this tablet, never one typed fresh.
 */
export function ConnectFields({
  value,
  onChange,
  onProbed,
  lockBaseUrl = false,
}: {
  value: ConnectFieldsValue
  onChange: (value: ConnectFieldsValue) => void
  onProbed: (probe: DayoProbe) => void
  lockBaseUrl?: boolean
}): JSX.Element {
  const api = useApi()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)

  const probe = useMutation({
    mutationFn: () => api.probeDayo({ baseUrl: value.baseUrl, apiKey: value.apiKey }),
    onSuccess: (p) => onProbed(p),
  })

  // Reads one QR frame at a time off the live preview until it finds a code or the person cancels — the camera
  // stream is stopped either way so the tablet is never left recording in the background.
  const startScan = async (): Promise<void> => {
    setScanError(null)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    } catch (e) {
      setScanError(e instanceof Error ? e.message : String(e))
      return
    }
    setScanning(true)
    const video = videoRef.current
    if (video === null) { stream.getTracks().forEach((t) => t.stop()); setScanning(false); return }
    video.srcObject = stream
    await video.play().catch(() => undefined)
    try {
      for (let attempt = 0; attempt < 50; attempt++) {
        try {
          const key = await scanQrOnce(video)
          onChange({ ...value, apiKey: key })
          return
        } catch {
          await new Promise((r) => setTimeout(r, 200))
        }
      }
      setScanError('no QR code found')
    } finally {
      stream.getTracks().forEach((t) => t.stop())
      setScanning(false)
    }
  }

  return (
    <div className="list">
      <label>
        {TH.setupBaseUrl}
        <input
          data-testid="setup-base-url"
          value={value.baseUrl}
          readOnly={lockBaseUrl}
          onChange={(e) => { if (!lockBaseUrl) onChange({ ...value, baseUrl: e.target.value }) }}
          required
        />
      </label>
      <label>
        {TH.setupApiKey}
        <input
          data-testid="setup-api-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value.apiKey}
          onChange={(e) => onChange({ ...value, apiKey: e.target.value })}
          required
        />
      </label>
      {qrScanSupported() && (
        <button type="button" data-testid="setup-scan" onClick={() => void startScan()} disabled={scanning}>
          {TH.setupScan}
        </button>
      )}
      {scanning && <video ref={videoRef} data-testid="setup-scan-video" muted playsInline />}
      {scanError !== null && (
        <p role="alert" className="error">
          {scanError}
        </p>
      )}
      <button type="button" data-testid="setup-probe" disabled={probe.isPending} onClick={() => probe.mutate()}>
        {TH.setupProbe}
      </button>
      {probe.isError && (
        <p role="alert" className="error">
          {errorMessage(probe.error)}
        </p>
      )}
      {probe.data !== undefined && (
        <div className="list">
          <p data-testid="setup-client-name">{TH.setupConnectedTo(probe.data.clientName)}</p>
          {!probe.data.pricingMatches && (
            <p className="warn" data-testid="setup-pricing-warn">
              {TH.pricingMismatchSetup}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
