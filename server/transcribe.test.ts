import { describe, expect, test } from 'bun:test'
import { dropEchoes } from './transcribe'

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
