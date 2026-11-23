// The session's figures, as status-feed.mjs leaves them in
// $CLAUDIO_RUN/status.json each time Claude Code runs the status line, and
// how the header shows them. Every figure is Claude Code's own.

export type Window = { left: number; resets: string | null }

export type Status = {
  model: string
  effort: string | null
  fast: boolean
  agent: string | null
  cwd: string
  branch: string | null
  context: { left: number; tokens: number; window: number } | null
  fiveHour: Window | null
  sevenDay: Window | null
  cost: number
  added: number
  removed: number
}

// The colours of the author's own status line, so a figure reads the same here
// as it did under the prompt.
export const INK = {
  dim: '#8E8A82',
  paper: '#F0EDE6',
  cyan: '#00E5E5',
  yellow: '#FFD400',
  green: '#00FF00',
  red: '#FF2D2D',
  blue: '#3B8CFF',
  pink: '#FF4FD8',
  void: '#2A2A28',
  rule: '#3A3834',
} as const

// Low to high, one colour for each tenth that is left.
const RAMP = [
  '#FF2D2D', '#FF6B00', '#FFD400', '#A8E000', '#00FF00',
  '#00E5A0', '#00E5E5', '#3B8CFF', '#8B5CFF', '#FF4FD8',
] as const

const EFFORT: Readonly<Record<string, Piece>> = {
  low: { text: 'LOW', color: INK.blue },
  medium: { text: 'MED', color: INK.cyan },
  xhigh: { text: 'XHIGH', color: INK.yellow },
  max: { text: 'MAX', color: INK.pink },
}

export type Piece = { text: string; color: string; bold?: boolean }

// A label, a value, a gauge and a line under it. `left` is what remains, 0 to
// 100; absent, there is no gauge.
export type Tile = { label: string; value: Piece; left?: number; detail: readonly Piece[] }

// The colour of a 0 to 100 reading, as the status line's `level`.
export const levelColor = (left: number): string =>
  RAMP[Math.max(0, Math.min(RAMP.length - 1, Math.floor(left / 10)))] ?? INK.paper

// The gauge as runs of one colour, `cells` long: the filled part climbs the
// ramp from red, the rest is a faint line.
export const gaugeOf = (left: number, cells: number): readonly Piece[] => {
  const full = Math.max(0, Math.min(cells, Math.floor((left * cells) / 100)))
  const runs: Piece[] = []
  for (let cell = 0; cell < full; cell += 1) {
    const color = levelColor((cell * 100) / cells)
    const last = runs.at(-1)
    if (last !== undefined && last.color === color) {
      last.text += '━'
    } else {
      runs.push({ text: '━', color })
    }
  }
  return full < cells ? [...runs, { text: '─'.repeat(cells - full), color: INK.void }] : runs
}

export const parseStatus = (text: string): Status | null => {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) {
    return null
  }
  const fields = data as Record<string, unknown>
  const string = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)
  const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
  const object = (value: unknown) =>
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
  const window = (value: unknown): Window | null => {
    const one = object(value)
    return one === null || typeof one.left !== 'number' ? null : { left: one.left, resets: string(one.resets) }
  }
  const context = object(fields.context)

  return {
    model: string(fields.model) ?? '',
    effort: string(fields.effort),
    fast: fields.fast === true,
    agent: string(fields.agent),
    cwd: string(fields.cwd) ?? '',
    branch: string(fields.branch),
    context:
      context === null
        ? null
        : { left: number(context.left), tokens: number(context.tokens), window: number(context.window) },
    fiveHour: window(fields.fiveHour),
    sevenDay: window(fields.sevenDay),
    cost: number(fields.cost),
    added: number(fields.added),
    removed: number(fields.removed),
  }
}

const compact = (tokens: number): string =>
  tokens >= 1_000_000
    ? `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
    : tokens >= 1000
      ? `${Math.round(tokens / 1000)}k`
      : String(tokens)

const WAITING = 'dopo la prima risposta'

const dim = (text: string): Piece => ({ text, color: INK.dim })
const NOTHING: Piece = dim('—')

const limitTile = (label: string, window: Window | null): Tile =>
  window === null
    ? { label, value: NOTHING, detail: [dim(WAITING)] }
    : {
        label,
        value: { text: `${window.left}% libero`, color: levelColor(window.left) },
        left: window.left,
        detail: [dim(window.resets === null ? 'ricarica: non si sa' : `si ricarica ${window.resets}`)],
      }

// Most useful first: a narrow terminal drops them from the end.
export const tilesOf = (status: Status): readonly Tile[] => [
  status.context === null || status.context.tokens === 0
    ? { label: 'MEMORIA DELLA CHAT', value: NOTHING, detail: [dim(WAITING)] }
    : {
        label: 'MEMORIA DELLA CHAT',
        value: { text: `${status.context.left}% libera`, color: INK.paper },
        left: status.context.left,
        detail: [dim(`${compact(status.context.tokens)} su ${compact(status.context.window)} token`)],
      },
  limitTile('LIMITE DI 5 ORE', status.fiveHour),
  limitTile('LIMITE DI 7 GIORNI', status.sevenDay),
  {
    label: 'COSTO STIMATO',
    value: dim(`$${status.cost.toFixed(2)}`),
    detail:
      status.added + status.removed === 0
        ? [dim('nessuna riga cambiata')]
        : [
            dim('righe '),
            { text: `+${status.added}`, color: INK.green },
            { text: ` −${status.removed}`, color: INK.red },
          ],
  },
]

// Model, then the modes that are off their default, as the status line lit them.
export const modelPieces = (status: Status): readonly Piece[] => {
  const effort = status.effort === null || status.effort === 'high' ? null : status.effort
  const lit: (Piece | null)[] = [
    status.model === '' ? null : { text: status.model, color: INK.yellow },
    status.fast ? { text: 'FAST', color: INK.green } : null,
    effort === null ? null : (EFFORT[effort] ?? { text: effort, color: INK.yellow }),
    status.agent === null ? null : { text: `● ${status.agent}`, color: INK.pink },
  ]
  return lit
    .filter(piece => piece !== null)
    .flatMap((piece, index) => (index === 0 ? [piece] : [{ text: ' · ', color: INK.rule }, piece]))
}

// Parents recede, the folder you are in leads.
export const pathPieces = (path: string): readonly Piece[] => {
  const cut = path.lastIndexOf('/') + 1
  return [dim(path.slice(0, cut)), { text: path.slice(cut), color: INK.paper, bold: true }].filter(
    piece => piece.text !== '',
  )
}

// How many of the tiles fit beside the crab and the name block.
export const tilesThatFit = (columns: number, beside: number, tile: number, count: number): number =>
  Math.max(0, Math.min(count, Math.floor((columns - beside) / tile)))
