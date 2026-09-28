// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DayoProbe, PosApi } from '../api/types'
import { ApiProvider } from '../app/api-context'
import { TH } from '../ui/th'
import { ConnectFields, type ConnectFieldsValue } from './ConnectFields'

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'BarcodeDetector')
  vi.unstubAllGlobals()
})

/** A controlling parent (like SetupScreen/OwnerRecoveryScreen): `value` is real React state fed back from
 * `onChange`, so a mid-scan edit of the field is visible to the component the way it would be in production. */
function Controlled({ onChange }: { onChange: (v: ConnectFieldsValue) => void }): JSX.Element {
  const [value, setValue] = useState<ConnectFieldsValue>({ baseUrl: '', apiKey: '' })
  return (
    <ConnectFields
      value={value}
      onChange={(v) => {
        setValue(v)
        onChange(v)
      }}
      onProbed={vi.fn()}
    />
  )
}

function mount(onChange: (v: ConnectFieldsValue) => void = () => undefined): void {
  const api = {} as unknown as PosApi
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={api}>
        <Controlled onChange={onChange} />
      </ApiProvider>
    </QueryClientProvider>,
  )
}

/** A `BarcodeDetector` whose one `detect()` call stays pending until the test resolves it — the deterministic
 * window this suite uses to prove the scan does not race the field it writes into. */
function pendingDetector(): { ctor: unknown; resolve: (codes: { rawValue: string }[]) => void } {
  let resolve!: (codes: { rawValue: string }[]) => void
  const promise = new Promise<{ rawValue: string }[]>((r) => { resolve = r })
  class FakeBarcodeDetector {
    async detect(): Promise<{ rawValue: string }[]> {
      return promise
    }
  }
  return { ctor: FakeBarcodeDetector, resolve }
}

function stubCamera(): { track: { stop: ReturnType<typeof vi.fn> } } {
  const track = { stop: vi.fn() }
  const stream = { getTracks: () => [track] } as unknown as MediaStream
  vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia: vi.fn(async () => stream) } })
  HTMLMediaElement.prototype.play = vi.fn(async () => undefined)
  return { track }
}

describe('ConnectFields — QR scan (quality review, fix round 1)', () => {
  it('reads the key from a mocked BarcodeDetector once the camera preview is up', async () => {
    const { ctor, resolve } = pendingDetector()
    ;(window as unknown as { BarcodeDetector: unknown }).BarcodeDetector = ctor
    const { track } = stubCamera()
    const onChange = vi.fn()
    mount(onChange)

    fireEvent.click(screen.getByTestId('setup-scan'))
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled())
    resolve([{ rawValue: 'dayo_scanned_key_0123456789abcdef0123456789abcdef01234567' }])

    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ baseUrl: '', apiKey: 'dayo_scanned_key_0123456789abcdef0123456789abcdef01234567' }))
    expect(track.stop).toHaveBeenCalled() // the camera is never left running
    expect(screen.queryByTestId('setup-scan-video')).toBeNull()
  })

  // Quality review: `videoRef.current` used to be read synchronously right after `setScanning(true)`, before
  // React had committed the `<video>` element — the scan could never succeed. The fix must start the stream only
  // once the video element actually exists (an effect keyed on `scanning`).
  it('attaches the camera stream to the video element that is actually in the DOM (no race with the render)', async () => {
    const { ctor, resolve } = pendingDetector()
    ;(window as unknown as { BarcodeDetector: unknown }).BarcodeDetector = ctor
    stubCamera()
    mount()

    fireEvent.click(screen.getByTestId('setup-scan'))
    const video = await screen.findByTestId('setup-scan-video')
    await waitFor(() => expect((video as HTMLVideoElement).srcObject).not.toBeNull())
    resolve([{ rawValue: 'dayo_x'.padEnd(69, '0') }])
  })

  // Quality review: a stale closure over `value` from when the scan started could overwrite a baseUrl the person
  // edited while the scan was still running. `onChange` must always carry the LATEST value, not the one captured
  // at the moment the scan button was pressed.
  it('never overwrites a baseUrl edited mid-scan with the stale value from when the scan started', async () => {
    const { ctor, resolve } = pendingDetector()
    ;(window as unknown as { BarcodeDetector: unknown }).BarcodeDetector = ctor
    stubCamera()
    const onChange = vi.fn()
    mount(onChange)

    fireEvent.click(screen.getByTestId('setup-scan'))
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled())
    // edited while the scan's detect() call is still pending
    fireEvent.change(screen.getByTestId('setup-base-url'), { target: { value: 'https://edited-mid-scan.example/api/v1' } })

    const key = 'dayo_scanned_after_edit_0123456789abcdef0123456789abcdef012345'
    resolve([{ rawValue: key }])
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ baseUrl: 'https://edited-mid-scan.example/api/v1', apiKey: key }))
  })

  it('shows a Thai message, not the raw browser text, when the camera is denied', async () => {
    ;(window as unknown as { BarcodeDetector: unknown }).BarcodeDetector = class {}
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia: vi.fn(async () => { throw new Error('Permission denied') }) } })
    mount()

    fireEvent.click(screen.getByTestId('setup-scan'))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(TH.scanCameraDenied)
    expect(alert.textContent).not.toContain('Permission denied')
  })
})
