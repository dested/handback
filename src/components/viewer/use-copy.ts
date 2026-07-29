import { useEffect, useRef, useState } from 'react'

/** Copy to the clipboard and flash a confirmation for a beat. */
export function useCopy(flashMs = 1600) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      return
    }
    setCopied(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), flashMs)
  }

  return { copied, copy }
}
