/**
 * spec §6.6 · §7 ข้อ 1 "สแกนหรือวาง": the dayo web shows a device's API key once, as text AND a QR code holding
 * that same text. This tablet reads it with Chrome/Android's `BarcodeDetector` — no polyfill, and no other scanner
 * library. When the browser lacks it (desktop Chrome without the flag, Safari, Firefox), the caller hides the scan
 * button and pasting the key text is the only path (already covered without this module).
 */
export function qrScanSupported(): boolean {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window
}

type DetectedBarcode = { rawValue: string }
type BarcodeDetectorLike = { detect: (source: HTMLVideoElement) => Promise<DetectedBarcode[]> }
type BarcodeDetectorCtor = new (options: { formats: string[] }) => BarcodeDetectorLike

/**
 * Reads one QR code from a live `<video>` element and returns its raw text — the API key, exactly as the dayo web
 * encoded it. Throws when the browser has no `BarcodeDetector`, or when no code is in view yet; the caller (a
 * short poll while the camera preview is up) retries on the next frame.
 */
export async function scanQrOnce(video: HTMLVideoElement): Promise<string> {
  const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
  if (Ctor === undefined) throw new Error('BarcodeDetector unavailable')
  const detector = new Ctor({ formats: ['qr_code'] })
  const codes = await detector.detect(video)
  const value = codes[0]?.rawValue
  if (value === undefined) throw new Error('no QR code in view')
  return value
}
