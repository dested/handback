import { describe, expect, test } from 'bun:test'
import { dropUnheard } from '@dested/video-to-prompt'
import { dropEchoes, pcmFromWav } from './transcribe'

describe('dropEchoes', () => {
  test('a line Whisper says again within 5 s of ending is kept once', () => {
    const out = dropEchoes([
      { t: 0, d: 2000, text: 'Look at the total.' },
      { t: 2400, d: 2000, text: 'Look at the total.' },
      { t: 5000, d: 1500, text: 'It went up by five.' },
    ])
    expect(out.map((s) => s.text)).toEqual(['Look at the total.', 'It went up by five.'])
  })

  test('the same words said again later are a new line', () => {
    const out = dropEchoes([
      { t: 0, d: 1000, text: 'Okay.' },
      { t: 7000, d: 1000, text: 'Okay.' },
    ])
    expect(out).toHaveLength(2)
  })
})

/** 16-bit PCM WAV, laid out the way the clients' encodeWav writes it, plus an optional extra chunk. */
function wav(samples: Float32Array, rate = 16000, extra = false): Uint8Array {
  const pad = extra ? 8 + 4 : 0
  const buf = new ArrayBuffer(44 + pad + samples.length * 2)
  const v = new DataView(buf)
  const ascii = (at: number, s: string) =>
    [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)))
  ascii(0, 'RIFF')
  v.setUint32(4, 36 + pad + samples.length * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  let at = 36
  if (extra) {
    ascii(at, 'LIST')
    v.setUint32(at + 4, 4, true)
    ascii(at + 8, 'INFO')
    at += 12
  }
  ascii(at, 'data')
  v.setUint32(at + 4, samples.length * 2, true)
  samples.forEach((s, i) => v.setInt16(at + 8 + i * 2, Math.round(s * 32767), true))
  return new Uint8Array(buf)
}

describe('pcmFromWav', () => {
  test('reads the samples and rate back, past any chunk before data', () => {
    const src = Float32Array.from([0, 0.5, -0.5, 0.25])
    for (const extra of [false, true]) {
      const pcm = pcmFromWav(wav(src, 16000, extra))
      expect(pcm?.sampleRate).toBe(16000)
      expect([...(pcm?.samples ?? [])].map((s) => Math.round(s * 100) / 100)).toEqual([
        0, 0.5, -0.5, 0.25,
      ])
    }
  })

  test('anything that is not 16-bit PCM WAV is null', () => {
    expect(pcmFromWav(new TextEncoder().encode('not a wav at all'))).toBeNull()
  })

  test('feeds the silence check: "Thank you." over a silent chunk goes, real words stay', () => {
    const audio = new Float32Array(16000 * 40)
    for (let i = 16000 * 2; i < 16000 * 3; i++) audio[i] = i % 2 ? 0.2 : -0.2
    const pcm = pcmFromWav(wav(audio))
    if (!pcm) throw new Error('no pcm')
    const kept = dropUnheard(
      [
        { t: 2000, d: 1000, text: 'Open settings.' },
        { t: 5000, d: 30000, text: 'Thank you.' },
      ],
      pcm.samples,
      pcm.sampleRate
    )
    expect(kept.map((s) => s.text)).toEqual(['Open settings.'])
  })
})
