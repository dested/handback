// A one-shot voice capture that ends in transcribed text — never audio the app
// keeps. It records mic → webm, decodes it through the same 16 kHz-mono path the
// phone pipeline uses, and posts to the cloud transcriber with this browser's
// hb_ token; the blob is discarded either way. The caller receives the joined
// text to drop into the answer box for review — it is never auto-submitted.
//
// Lifted verbatim from the old agent-answer panel so the exchange's answer form
// keeps the exact record/transcribe behavior.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useCaptureToken } from '~/lib/capture-token'
import { decodeMono } from '~/lib/capture/audio'
import { transcribeInCloud } from '~/lib/capture/transcribe'
import { mmss } from '../format'

const MAX_SECONDS = 120

export function useVoiceAnswer(onResult: (text: string) => void) {
  const withToken = useCaptureToken('Answer')
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [seconds, setSeconds] = useState(0)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Held in refs so the async onstop closure and the transcribe step always see
  // the current callback/token helper, not the ones captured when recording began.
  const onResultRef = useRef(onResult)
  onResultRef.current = onResult
  const withTokenRef = useRef(withToken)
  withTokenRef.current = withToken

  const stopClock = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const finish = useCallback(async (blob: Blob) => {
    setTranscribing(true)
    try {
      const audio = await decodeMono(blob)
      if (!audio) {
        setError('transcription unavailable — type it instead')
        return
      }
      const heard = await withTokenRef.current((token) => transcribeInCloud(audio, { token }))
      const text = (heard ?? [])
        .map((segment) => segment.text.trim())
        .filter(Boolean)
        .join(' ')
      if (!text) {
        setError('transcription unavailable — type it instead')
        return
      }
      onResultRef.current(text)
    } catch {
      // A dead token survives one silent re-mint inside withToken; a second
      // failure, or any other throw, lands here as the same terse line.
      setError('transcription unavailable — type it instead')
    } finally {
      setTranscribing(false)
    }
  }, [])

  const stop = useCallback(() => {
    stopClock()
    setRecording(false)
    const rec = recorderRef.current
    if (rec && rec.state !== 'inactive') rec.stop()
  }, [stopClock])

  const start = useCallback(async () => {
    setError(null)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setError('microphone unavailable')
      return
    }
    let rec: MediaRecorder
    try {
      rec = new MediaRecorder(stream, { mimeType: 'audio/webm' })
    } catch {
      // Safari won't take an explicit webm mime — let it pick its own container;
      // decodeAudioData reads whatever comes back.
      rec = new MediaRecorder(stream)
    }
    chunksRef.current = []
    rec.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data)
    }
    rec.onstop = () => {
      for (const track of stream.getTracks()) track.stop()
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' })
      chunksRef.current = []
      void finish(blob)
    }
    recorderRef.current = rec
    rec.start()
    setSeconds(0)
    setRecording(true)
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000)
  }, [finish])

  // Auto-stop at the cap — kept out of the tick so the clock updater stays pure.
  useEffect(() => {
    if (recording && seconds >= MAX_SECONDS) stop()
  }, [recording, seconds, stop])

  // Tear the mic down if the panel unmounts mid-record.
  useEffect(
    () => () => {
      stopClock()
      const rec = recorderRef.current
      if (rec && rec.state !== 'inactive') rec.stop()
    },
    [stopClock]
  )

  const toggle = useCallback(() => {
    setError(null)
    if (recording) stop()
    else void start()
  }, [recording, start, stop])

  return { recording, transcribing, error, clock: mmss(seconds * 1000), toggle }
}
