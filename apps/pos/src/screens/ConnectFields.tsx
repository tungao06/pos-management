import { useMutation } from '@tanstack/react-query'
import { useEffect, useRef, useState, type JSX } from 'react'
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
 *
 * SECURITY I1 (controller ruling, fix round 1): the key field renders as `type="text"` with CSS
 * `-webkit-text-security` (`.text-mask`) instead of `type="password"` — Chrome ignores `autocomplete="off"` on a
 * password input inside a form and offers to save it to Google Password Manager regardless; a masked text input
 * never triggers that at all.
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
  const streamRef = useRef<MediaStream | null>(null)
  // Quality review (fix round 1): `onChange` must always write the LATEST value, even though the scan loop below
  // is a long-lived async closure started at one point in time — without this ref, editing `value.baseUrl` while
  // a scan is still running would be silently overwritten by whatever `value` was when the scan began.
  const valueRef = useRef(value)
  useEffect(() => {
    valueRef.current = value
  }, [value])
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  // SECURITY (fix round 2): guards the camera against a leaked `MediaStream`. A double-tap on the scan button (or
  // an unmount while `getUserMedia` is still pending) used to leave a live stream nobody ever stopped — the two
  // refs below close both gaps: `startingRef` stops a second tap from starting a second stream while the first is
  // still being requested, and `unmountedRef` lets `startScan` notice the component is gone by the time the browser
  // finally hands back a stream, so that stream is stopped immediately instead of being stored and forgotten.
  const startingRef = useRef(false)
  const unmountedRef = useRef(false)

  useEffect(() => {
    return () => {
      unmountedRef.current = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  const probe = useMutation({
    mutationFn: () => api.probeDayo({ baseUrl: value.baseUrl, apiKey: value.apiKey }),
    onSuccess: (p) => onProbed(p),
  })

  // Only asks for the camera and flips `scanning` on — the actual stream/detect loop runs in the effect below,
  // once React has committed the `<video>` element `scanning` reveals (quality review: reading `videoRef.current`
  // right here, before that commit, is why the scan could never succeed before this fix).
  const startScan = async (): Promise<void> => {
    if (startingRef.current || scanning) return
    startingRef.current = true
    setScanError(null)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    } catch {
      startingRef.current = false
      setScanError(TH.scanCameraDenied)
      return
    }
    startingRef.current = false
    if (unmountedRef.current) {
      stream.getTracks().forEach((t) => t.stop())
      return
    }
    streamRef.current = stream
    setScanning(true)
  }

  useEffect(() => {
    if (!scanning) return
    const stream = streamRef.current
    const video = videoRef.current
    if (stream === null || video === null) {
      setScanning(false)
      return
    }
    let cancelled = false
    video.srcObject = stream
    const run = async (): Promise<void> => {
      await video.play().catch(() => undefined)
      try {
        for (let attempt = 0; attempt < 50 && !cancelled; attempt++) {
          try {
            const key = await scanQrOnce(video)
            if (!cancelled) onChange({ ...valueRef.current, apiKey: key })
            return
          } catch {
            await new Promise((r) => setTimeout(r, 200))
          }
        }
        if (!cancelled) setScanError(TH.scanNoCode)
      } finally {
        stream.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        if (!cancelled) setScanning(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onChange is the parent's setter identity, stable enough here; re-running this effect on it would restart the scan mid-flight.
  }, [scanning])

  return (
    <div className="list">
      <label>
        {TH.setupBaseUrl}
        <input
          data-testid="setup-base-url"
          name="dayo-base-url"
          value={value.baseUrl}
          readOnly={lockBaseUrl}
          onChange={(e) => {
            if (!lockBaseUrl) onChange({ ...value, baseUrl: e.target.value })
          }}
          required
        />
      </label>
      <label>
        {TH.setupApiKey}
        <input
          data-testid="setup-api-key"
          type="text"
          className="text-mask"
          name="dayo-connect-key"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={value.apiKey}
          onChange={(e) => onChange({ ...value, apiKey: e.target.value })}
          required
        />
      </label>
      {qrScanSupported() && (
        <button type="button" data-testid="setup-scan" onClick={() => void startScan()} disabled={scanning || startingRef.current}>
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
