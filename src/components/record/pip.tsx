import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * The recorder panel, in a window that floats over everything else.
 *
 * The extension gets this for free: a side panel is browser chrome, so it stays
 * on screen while you drive the app you're narrating. A tab does not — the
 * moment you switch to the thing you're recording, the recorder is behind it,
 * along with the elapsed clock, the frame count and the stop button. Document
 * Picture-in-Picture is the web's answer: a real same-origin document, always on
 * top, that React can render straight into.
 *
 * Two things learned elsewhere in this repo apply exactly:
 *
 * 1. **It must be opened by its own click.** `requestWindow()` needs a user
 *    gesture and the Record click is spent on the share picker — the puck hit
 *    this and it is written down (decisions.md 2026-08-01). So this is a button
 *    the person presses, never something that happens on Record.
 * 2. **It is captured like anything else on screen.** Sharing the entire screen
 *    puts this window in the recording — but it does the same to the extension's
 *    side panel, which lives inside the Chrome window. Sharing a tab or a window
 *    captures neither. Parity, not a regression.
 *
 * Styles are copied rather than linked: the PiP document starts empty, and it
 * has to survive both dev (Vite injects `<style>` tags) and prod (a hashed
 * `<link>`), so every sheet in the head is cloned across.
 */

interface DocumentPictureInPictureOptions {
  width?: number
  height?: number
  disallowReturnToOpener?: boolean
  preferInitialWindowPlacement?: boolean
}

interface DocumentPictureInPictureApi {
  requestWindow(options?: DocumentPictureInPictureOptions): Promise<Window>
}

declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPictureApi
  }
}

/** Chromium only, for now. Everywhere else the panel simply stays in the page. */
export function pipSupported(): boolean {
  return typeof window !== 'undefined' && window.documentPictureInPicture !== undefined
}

function copyStyles(into: Window): void {
  for (const node of Array.from(document.head.querySelectorAll('style, link[rel="stylesheet"]'))) {
    into.document.head.appendChild(node.cloneNode(true))
  }
  // The page's own ground, so the floating panel isn't a white rectangle on a
  // paper-coloured site.
  into.document.body.classList.add('bg-background', 'text-foreground')
}

export interface PipHandle {
  supported: boolean
  /** The live window, or null when the panel belongs in the page. */
  win: Window | null
  open: () => Promise<void>
  close: () => void
}

export function usePipWindow(size: { width: number; height: number }): PipHandle {
  const [win, setWin] = useState<Window | null>(null)
  const [supported, setSupported] = useState(false)

  // Reading the API is a browser question, so it waits for the client — this
  // page is server-rendered like every other.
  useEffect(() => setSupported(pipSupported()), [])

  const open = useCallback(async () => {
    const api = window.documentPictureInPicture
    if (!api) return
    const opened = await api.requestWindow({ width: size.width, height: size.height })
    copyStyles(opened)
    // Closing it from its own titlebar has to put the panel back in the page.
    opened.addEventListener('pagehide', () => setWin(null), { once: true })
    setWin(opened)
  }, [size.width, size.height])

  const close = useCallback(() => {
    win?.close()
    setWin(null)
  }, [win])

  // A PiP window outlives the React tree that opened it; leaving the page with
  // one still floating would strand a recorder nothing can stop.
  useEffect(() => {
    if (!win) return
    return () => win.close()
  }, [win])

  return { supported, win, open, close }
}

/** Renders into the PiP window when there is one, and in place when there isn't. */
export function PipHost({ win, children }: { win: Window | null; children: ReactNode }) {
  if (!win) return <>{children}</>
  return createPortal(children, win.document.body)
}
