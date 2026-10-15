import { describe, expect, test } from 'bun:test'
import { formatWalkthrough, imagesContent, type FormattableWalkthrough } from './mcp-format'

const url = (path: string) => `https://r2.example/${path}?X-Amz-Signature=abc`
const file = (path: string) => ({ path, url: url(path) })

const modern: FormattableWalkthrough = {
  id: 'w1',
  slug: '2026-10-15-1402-checkout',
  space: 'Acme',
  title: 'Checkout total is off',
  status: 'open',
  recordedAt: '2026-10-15T14:02:00.000Z',
  durationMs: 31000,
  errorCount: 1,
  droppedCount: 0,
  takes: [{ index: 1, dir: 'rec-01' }],
  intent: 'bug',
  digestMd: 'DIGEST',
  summaryMd: 'LEDGER',
  points: [
    {
      id: 'kp1',
      title: 'Total is $5 high',
      detail: 'The total reads 12.45; the items add to 12.40.',
      severity: 'high',
      atMs: 8000,
      evidence: {
        said: { text: 'it should still be twelve forty', atMs: 8200, endMs: 10800 },
        frame: { path: 'rec-01/frames/04-0090.jpg', atMs: 9000, what: 'changed top-right (small)' },
        error: { message: 'TypeError: x is undefined', atMs: 9400 },
      },
    },
  ],
  projectInstructions: 'PROJECT RULES',
  curation: { frames: [], excluded: [{ startMs: 1000, endMs: 2000, reason: 'false start' }] },
  reportMd: 'LEGACY',
  briefMd: null,
  refinedBriefMd: 'WORKING BRIEF',
  recordingMd: 'RECORDING',
  recordingRebuilt: true,
  files: [
    'report.md',
    'rec-01/walkthrough.webm',
    'rec-01/frames/01-0000.jpg',
    'rec-01/frames/04-0090.jpg',
    'rec-01/grids/grid_01.jpg',
    'rec-01/transcript.txt',
    'attachments/spec.pdf',
  ].map(file),
  notes: [
    {
      role: 'reviewer',
      kind: 'result',
      summary: 'SEND BACK',
      prUrl: null,
      filesTouched: [],
      bodyMd: null,
      authorName: 'Sal',
      createdAt: '2026-10-15T15:00:00.000Z',
    },
  ],
  comments: [
    { authorName: 'Sal', atMs: 9000, text: 'COMMENT', createdAt: '2026-10-15T15:01:00.000Z' },
  ],
  missingFiles: [],
}

describe('formatWalkthrough', () => {
  test('section order: obligations and humans first, the recording after', () => {
    const brief = formatWalkthrough(modern)
    const order = [
      'INTENT: BUG',
      '# Checkout total is off',
      '--- key points ---',
      '--- review thread ---',
      '--- comments ---',
      '--- project instructions ---',
      '--- working brief ---',
      '--- the recording ---',
      '--- attachments ---',
      '--- files ---',
    ].map((marker) => brief.indexOf(marker))
    expect(order.every((at) => at >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  test('key points carry their evidence', () => {
    const brief = formatWalkthrough(modern)
    expect(brief).toContain('KP1 (high) at 0:08 — Total is $5 high')
    expect(brief).toContain('  said 0:08–0:11: "it should still be twelve forty"')
    expect(brief).toContain('  frame rec-01/frames/04-0090.jpg (0:09, changed top-right (small))')
    expect(brief).toContain('  error at 0:09: TypeError: x is undefined')
  })

  test('the human-facing layers stay out; the rebuilt report marks its own cuts', () => {
    const brief = formatWalkthrough(modern)
    expect(brief).not.toContain('DIGEST')
    expect(brief).not.toContain('LEDGER')
    expect(brief).not.toContain('LEGACY')
    expect(brief).not.toContain('--- removed from this walkthrough ---')
    expect(brief).toContain('walkthroughId w1 · space Acme · status open')
  })

  test('paths, not presigned URLs, except the video', () => {
    const brief = formatWalkthrough(modern)
    expect(brief.match(/X-Amz-Signature/g)).toHaveLength(1)
    expect(brief).toContain(
      'video rec-01/walkthrough.webm — https://r2.example/rec-01/walkthrough.webm'
    )
    expect(brief).toContain('2 frames rec-01/frames/01-0000.jpg … rec-01/frames/04-0090.jpg')
    expect(brief).toContain('report.md (as uploaded; the recording above is newer)')
    expect(brief).toContain('attachments/spec.pdf')
  })

  test('a body from an older server still reads: one document, cut spans listed', () => {
    const {
      briefMd: _b,
      refinedBriefMd: _r,
      recordingMd: _m,
      recordingRebuilt: _x,
      ...old
    } = modern
    const brief = formatWalkthrough(old)
    expect(brief).toContain('--- the recording ---\n\nLEGACY')
    expect(brief).not.toContain('--- working brief ---')
    expect(brief).toContain('--- removed from this walkthrough ---')
  })
})

describe('imagesContent', () => {
  test('each image under its label, then what was left out', () => {
    const content = imagesContent({
      images: [
        { label: 'rec-01/frames/04-0090.jpg · 0:09 · KP1', data: 'AAAA', mimeType: 'image/jpeg' },
      ],
      skipped: ['nope.jpg'],
      more: ['rec-01/frames/10-0295.jpg'],
    })
    expect(content.map((c) => c.type)).toEqual(['text', 'image', 'text'])
    const tail = content[2]
    expect(tail?.type === 'text' ? tail.text : '').toContain('nope.jpg')
  })
})
