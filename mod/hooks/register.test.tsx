import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const PINNED = {
  plugin: 'claudio',
  component: 'Placed',
  requestId: 'claudio-header',
  surface: 'terminal',
  viewport: { columns: 120, rows: 40, isFullscreen: true },
  props: { plugin: 'claudio', id: 'header' },
} as const

const ACTS = { 'a@100': ['00.png', '01.png'], b: ['00.png', '01.png', '02.png'] } as const

// What the engine answers beneath the mod; returns the pictures swapped in.
const engine = (
  on: On,
  acts: Readonly<Record<string, readonly string[]>>,
  env: Readonly<Record<string, string>> = {},
  placed: string[] = [],
  sites: Set<string> = new Set(),
): string[] => {
  const swapped: string[] = []
  mock.env(on, { HOME: '/home/me', ...env })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.version', () => ({ value: { version: '2.1.330' } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  const entry = (name: string, kind: 'file' | 'dir') => ({ name, kind, size: 1, mtimeMs: 0, isLink: false })
  on('fs.list', (_, e) => {
    const name = e.path.split('/').at(-1) ?? ''
    const frames = acts[name]
    return {
      value:
        frames === undefined
          ? Object.keys(acts).map(one => entry(one, 'dir'))
          : frames.map(one => entry(one, 'file')),
    }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('ui.place', (_, e) => {
    placed.push(e.id)
    return { value: { isPlaced: true as const, requestId: 'row-1' } }
  })
  on('ui.blit', (_, e) => {
    sites.add(e.requestId)
    if ('source' in e && 'file' in e.source) {
      swapped.push(e.source.file.split('/').slice(-2).join('/'))
    }
    return { value: {} }
  })
  return swapped
}

const turn = { text: 'ciao', turnId: 't1' } as const
const done = { answer: 'ecco', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' } as const

test('the crab plays an act at its own speed and goes back to the idle pose', async ($, on) => {
  const clock = mock.clock(on)
  const swapped = engine(on, ACTS)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  await clock.advance(1000)
  expect(swapped).toEqual([])

  await $.turn.start(turn)
  await clock.advance(400)
  expect(swapped).toEqual(['a@100/01.png', 'a@100/00.png', 'a@100/01.png', 'a@100/00.png'])

  await $.turn.complete(done)
  expect(swapped.at(-1)).toBe('a@100/00.png')
  const count = swapped.length
  await clock.advance(1000)
  expect(swapped.length).toBe(count)
})

test('after about four seconds he moves on to the next act, then back', async ($, on) => {
  const clock = mock.clock(on)
  const swapped = engine(on, ACTS)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  await $.turn.start(turn)
  // Act a: 20 loops of 2 frames, 100 ms each, so frame 40 opens act b.
  await clock.advance(4000)
  expect(swapped.length).toBe(40)
  expect(swapped[38]).toBe('a@100/01.png')
  expect(swapped[39]).toBe('b/00.png')
  // Act b: 10 loops of 3 frames at the default 130 ms.
  await clock.advance(130 * 30)
  expect(swapped[40]).toBe('b/01.png')
  expect(swapped[69]).toBe('a@100/00.png')
  await $.turn.complete(done)
})

test('an interrupted turn stops the crab too', async ($, on) => {
  const clock = mock.clock(on)
  const swapped = engine(on, ACTS)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  await $.turn.start(turn)
  await clock.advance(125)
  await $.turn.complete({ ...done, isAborted: true, reason: 'aborted' })
  const count = swapped.length
  await clock.advance(1000)
  expect(swapped.length).toBe(count)
  expect(swapped.at(-1)).toBe('a@100/00.png')
})

test('a subagent turn moves nothing', async ($, on) => {
  const clock = mock.clock(on)
  const swapped = engine(on, ACTS)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  await $.turn.start({ ...turn, agentId: 'a1' })
  await clock.advance(1000)
  expect(swapped).toEqual([])
})

test('with no frames the still crab is drawn in the pinned header', async ($, on) => {
  const clock = mock.clock(on)
  const swapped = engine(on, {})
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(PINNED)
  expect((await ui.find({ type: 'Text', text: /Claudio/ }))?.text).toContain('Claudio')
  await $.turn.start(turn)
  await clock.advance(1000)
  expect(swapped).toEqual([])
  await ui.unmount()
})

const STATUS = {
  model: 'Opus 5.5',
  effort: 'xhigh',
  fast: false,
  agent: null,
  cwd: '~/projects/trattoria',
  branch: 'main',
  context: { left: 90, tokens: 98231, window: 1000000 },
  fiveHour: { left: 15, resets: '14:30' },
  sevenDay: null,
  cost: 0.7123,
  added: 120,
  removed: 30,
}

const headerTexts = async (
  $: Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[0],
  columns: number,
) => {
  const ui = await $.ui.mount({ ...PINNED, viewport: { columns, rows: 40, isFullscreen: true } })
  const texts = (await ui.findAll({ type: 'Text' })).map(one => one.text)
  await ui.unmount()
  return texts
}

test('the header shows the figures of the status file', async ($, on) => {
  const clock = mock.clock(on)
  engine(on, {}, { CLAUDIO_RUN: '/run' })
  on('fs.read', (_, e) => ({ value: e.path === '/run/status.json' ? JSON.stringify(STATUS) : '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(1500)

  const wide = await headerTexts($, 274)
  expect(wide).toContain('Opus 5.5 · XHIGH')
  expect(wide).toContain('~/projects/trattoria')
  expect(wide).toContain('━━━━━━━━━━━━━━━━━━──')
  expect(wide).toContain('ramo main')
  expect(wide).toContain('90% libera')
  expect(wide).toContain('98k su 1M token')
  expect(wide).toContain('15% libero')
  expect(wide).toContain('si ricarica 14:30')
  expect(wide).toContain('dopo la prima risposta')
  expect(wide).toContain('$0.71')
  expect(wide).toContain('righe +120 −30')

  const narrow = await headerTexts($, 110)
  expect(narrow).toContain('MEMORIA DELLA CHAT')
  expect(narrow).toContain('LIMITE DI 5 ORE')
  expect(narrow).not.toContain('LIMITE DI 7 GIORNI')
  expect(narrow).not.toContain('COSTO STIMATO')
})

test('a broken status file keeps the plain header', async ($, on) => {
  const clock = mock.clock(on)
  engine(on, {}, { CLAUDIO_RUN: '/run' })
  on('fs.read', () => ({ value: '{"model":' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(1500)

  const texts = await headerTexts($, 274)
  expect(texts).toContain('Opus 5.5')
  expect(texts).not.toContain('COSTO STIMATO')
})

test('without the pinned slot the header becomes one transcript row', async ($, on) => {
  const clock = mock.clock(on)
  const placed: string[] = []
  engine(on, {}, {}, placed)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(2400)
  expect(placed).toEqual([])
  await clock.advance(5000)
  expect(placed).toEqual(['header'])
})

test('with the pinned slot no row is placed', async ($, on) => {
  const clock = mock.clock(on)
  const placed: string[] = []
  engine(on, {}, {}, placed)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PINNED)
  await clock.advance(5000)
  expect(placed).toEqual([])
  await ui.unmount()
})

const COMPOSE = {
  model: 'claude-opus-5-5',
  promptModel: 'claude-opus-5-5',
  surfaces: ['terminal'],
  tools: [],
  outputStyle: null,
  traits: [],
} as const

test('the spoken voices are named only where this computer has them', async ($, on) => {
  engine(on, {}, { CLAUDIO_VOICES: '1' })
  on('prompt.compose', () => ({ sections: [] }))
  const { sections } = await $.prompt.compose(COMPOSE as never)
  expect(sections.at(-1)?.text).toContain('claudio-festa')
})

test('elsewhere the voice says nothing of them', async ($, on) => {
  engine(on, {})
  on('prompt.compose', () => ({ sections: [] }))
  const { sections } = await $.prompt.compose(COMPOSE as never)
  expect(sections.at(-1)?.text).toContain('# Claudio')
  expect(sections.at(-1)?.text).not.toContain('claudio-festa')
})

test('the crab moves in the row too, where nothing is pinned', async ($, on) => {
  const clock = mock.clock(on)
  const sites = new Set<string>()
  engine(on, ACTS, {}, [], sites)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PINNED, requestId: 'row-1' })
  await $.turn.start(turn)
  await clock.advance(300)
  expect([...sites]).toEqual(['row-1'])
  await $.turn.complete(done)
  await ui.unmount()
})
