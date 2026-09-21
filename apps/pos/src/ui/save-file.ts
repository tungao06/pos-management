/**
 * Saves bytes as a file through the browser's download (Android Chrome → the Downloads folder) — Q3b-6 · D52.
 * The object URL is revoked a minute later, after the download has surely started.
 */
export function downloadBytes(fileName: string, bytes: Uint8Array, mime = 'application/vnd.sqlite3'): void {
  const blob = new Blob([bytes.slice()], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
