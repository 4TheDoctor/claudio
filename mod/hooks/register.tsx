import type { EngineInterface, Register } from 'claude-code'

import { gaugeOf, INK, modelPieces, parseStatus, pathPieces, type Status, tilesOf, tilesThatFit } from './status'

// Claudio: Claude Code in Italian mode. Loaded only by the `claudio` command
// (--plugin-dir), on a binary copy whose stock startup banner is hidden, so
// the header below is the only one on screen.

const HEADER_ID = 'header'

// In fullscreen the patched copy (vendor/tweakcc claudioHeader.ts) pins the
// header above the transcript: it asks for a `Placed` drawing of this
// plugin's "header" under this requestId and takes HEADER_ROWS rows for it.
// Both values must match the patch's CLAUDIO_HEADER_REQUEST_ID and
// CLAUDIO_HEADER_ROWS. Where nothing is asked under it (the main screen, or a
// Claude Code without the patch) the header is placed as a transcript row
// instead and scrolls away. PIN_WAIT_MS is how long to wait for the asking.
const PINNED_REQUEST_ID = 'claudio-header'
const HEADER_ROWS = 5
const PIN_WAIT_MS = 2500
const CRAB = { columns: 13, rows: 5 } as const

// The crab's acts are folders of frames, art/crab/<act>/00.png, 01.png…
// (tools/build-crab-frames.py makes them). An act named "spin@250" holds each
// frame 250 ms. While a turn runs he plays one act after another, each for
// about CRAB_ACT_MS. The act named "idle" is the other way round: between turns
// he stands on its frame 00 and plays it once every CRAB_REST_MS. Without it he
// stands on the first act's frame 00. With no acts, art/crab.png is drawn.
const CRAB_KEY = 'crab'
const CRAB_DIR = 'art/crab'
const CRAB_FRAME_MS = 130
const CRAB_ACT_MS = 4000
const CRAB_REST_MS = 6000
const CRAB_STILL = 'art/crab.png'

// Beside the crab: the name block, then one tile per figure. The figures come
// from a file the status line command rewrites, read this often.
const NAME_COLUMNS = 38
const TILE_COLUMNS = 27
const GAUGE_CELLS = 20
const STATUS_POLL_MS = 1500

type Act = { frames: readonly string[]; frameMs: number; loops: number }

const actOf = (name: string, files: readonly string[]): Act => {
  const frames = files
    .filter(file => /^\d{2}\.png$/.test(file))
    .sort()
    .map(file => `${CRAB_DIR}/${name}/${file}`)
  const frameMs = Number(name.match(/@(\d+)$/)?.[1] ?? CRAB_FRAME_MS) || CRAB_FRAME_MS
  return { frames, frameMs, loops: Math.max(1, Math.round(CRAB_ACT_MS / (frameMs * Math.max(1, frames.length)))) }
}

const isIdle = (name: string): boolean => name === 'idle' || name.startsWith('idle@')

const FLAG = { green: '#009246', white: '#f1f2f1', red: '#ce2b37' } as const
const AMBER = '#e0a030'

// The spinner word is resampled by the engine once per turn; a render hook
// runs many times a second. Mapping the engine's word to an Italian one by
// hash keeps it stable for the whole turn instead of flickering.
const WORKING = [
  'Cucinando',
  'Impastando',
  'Mescolando il sugo',
  'Gesticolando',
  'Sorseggiando un espresso',
  'Stendendo la pasta',
  'Assaggiando',
  'Chiamando la mamma',
  'Grattugiando il parmigiano',
  'Facendo la scarpetta',
  'Litigando col forno',
  'Aspettando che bolla l’acqua',
] as const

const DONE = ['Sfornato', 'Impiattato', 'Servito', 'Mantecato', 'Cucinato', 'Assaggiato'] as const

// Tool rows say what Claudio is doing, in Italian. Only these tools get the
// compact row; any other tool keeps the engine's own drawing.
const TOOL_VERBS: Record<string, string> = {
  Read: 'Leggo',
  Write: 'Scrivo',
  Edit: 'Ritocco',
  MultiEdit: 'Ritocco',
  NotebookEdit: 'Ritocco',
  Bash: 'Eseguo',
  Grep: 'Cerco',
  Glob: 'Frugo',
  WebSearch: 'Googlo',
  WebFetch: 'Scarico',
}

// MCP tools (mcp__server__tool) get a phone call: "Telefono  voicemode · converse".
const verbOf = (tool: string): string | undefined =>
  TOOL_VERBS[tool] ?? (tool.startsWith('mcp__') ? 'Telefono' : undefined)

const mcpLabel = (tool: string): string => {
  const [, server = '', name = ''] = tool.split('__')
  return `${server.replace(/^plugin_/, '').split('_').at(-1) ?? server} · ${name}`
}

type Call = { tool: string; input: unknown; isRunning: boolean; isErrored: boolean; isInterrupted: boolean }

const markOf = (call: Call): { glyph: string; color: string } =>
  call.isRunning
    ? { glyph: '·', color: 'gray' }
    : call.isInterrupted
      ? { glyph: '⊘', color: AMBER }
      : call.isErrored
        ? { glyph: '✗', color: FLAG.red }
        : { glyph: '✓', color: FLAG.green }

// Results that only say "Read 42 lines" and the like. Diffs, command output
// and every error stay visible; ctrl+o shows everything as usual.
const QUIET_RESULTS = new Set(['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch'])

// Claudio's voice, added last to the system prompt. It replaces the reply
// persona from CLAUDE.md for this session only; plain `claude` never loads it.
const VOICE = {
  id: 'claudio:voice',
  scope: 'session',
  text: `# Claudio

In this session you are Claudio: Claude Code in Italian mode, started with the \`claudio\` command. Claudio is an Italian who has lived in Spain for years and speaks Spanish the way an Italian does: fluent Castilian Spanish (tú, vale, tío) with Italian woven in. Think Buzz Lightyear's Spanish mode, but Italian.

Voice:
- A few Italian interjections per reply, not in every sentence: allora, ecco, dai, mamma mia, madonna, ma che…, certo, perfetto, bellissimo, andiamo, basta, piano piano, capito?, va bene, boh.
- Now and then an Italianized Spanish phrase: "esto es una cosa bellissima", "ma no, tío", "molto bien", a calque or a slipped article. Every sentence must stay easy to understand.
- Italian food and family metaphors only when they genuinely fit: code al dente, a bug like pineapple on pizza, nonna would never ship this.
- Warm and a bit theatrical. The drama lives in the tone, never in the length.

This voice replaces any reply persona described in CLAUDE.md for this session. Every other instruction there still applies.

The voice is only for what you say to the user in chat. Code, identifiers, comments, commit messages, file contents, UI strings and commands stay exactly as the project needs them, with no Italian in them. Facts come first: the character never blurs a number, a path, a command or a warning. When something is serious (data loss, security, a failing check), say it plainly; the accent stays, the jokes go.`,
} as const

// Added where CLAUDIO_VOICES=1 (local.env): the computer has VoiceMode and
// four voices under these names.
const SPOKEN = `

Spoken VoiceMode line (converse): in this session use Claudio's voices and no other, whatever CLAUDE.md names. Pick one by the mood of what you are about to say:
- claudio-festa: good news. Something finished, a check passed, a win.
- claudio-tragedia: bad news. A failure, an error, a blocker, a risk.
- claudio-chiacchiera: the line asks the user something or waits on their decision.
- claudio-racconto: everything else (explaining, reporting progress), and the default when unsure.
The spoken line follows CLAUDE.md otherwise: one or two short sentences, Spanish with Italian sprinkles, no code, paths or command output.`

type Header = { version: string; model: string; cwd: string }

type Crab = {
  acts: readonly Act[]
  idle: Act | null
  isWorking: boolean
  act: number
  // Frames shown in this act so far, counting every loop.
  step: number
  // Where he is drawn: the pinned header, or else the placed row.
  site: string
  timer: { cancel: () => void } | null
}

const crabAct = (crab: Crab): Act | undefined =>
  crab.isWorking ? crab.acts[crab.act] : (crab.idle ?? crab.acts[0])

const crabFile = (crab: Crab): string => {
  const frames = crabAct(crab)?.frames ?? []
  return frames[crab.step % Math.max(1, frames.length)] ?? CRAB_STILL
}

// The next frame. At work, another act once this one has played its loops; at
// rest, back to standing after one go.
const crabMoves = (crab: Crab): void => {
  const current = crabAct(crab)
  crab.step += 1
  if (current === undefined) {
    return
  }
  if (crab.step >= current.frames.length * (crab.isWorking ? current.loops : 1)) {
    crab.step = 0
    crab.act = crab.isWorking ? (crab.act + 1) % crab.acts.length : crab.act
  }
}

// Shows his current frame. A header that is not on screen refuses the swap,
// which is fine.
const crabShows = ($: EngineInterface, crab: Crab): void => {
  void $.ui
    .blit({
      requestId: crab.site,
      key: CRAB_KEY,
      source: { file: `${$.plugin.root}/${crabFile(crab)}`, format: 'png' },
    })
    .catch(() => undefined)
}

// Keeps him moving until the next call, which starts him over from standing.
const crabPlays = ($: EngineInterface, crab: Crab): void => {
  crab.timer?.cancel()
  crab.timer = null
  const current = crabAct(crab)
  const canMove = crab.isWorking ? crab.acts.some(one => one.frames.length > 1) : (crab.idle?.frames.length ?? 0) > 1
  if (current === undefined || !canMove) {
    return
  }
  const isResting = !crab.isWorking && crab.step === 0
  const timer = $.clock.after(isResting ? CRAB_REST_MS : current.frameMs, () => {
    // A newer call took over while this tick was already on its way.
    if (crab.timer !== timer) {
      return
    }
    crabMoves(crab)
    crabShows($, crab)
    crabPlays($, crab)
  })
  crab.timer = timer
}

const pick = <T,>(list: readonly T[], seed: string): T => {
  let hash = 0
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) | 0
  }
  return list[Math.abs(hash) % list.length] as T
}

// `$.session.model()` gives the raw id (claude-opus-5-5); show it the way
// /model does (Opus 5.5). Anything that does not fit the pattern is shown as is.
const displayModel = (id: string): string => {
  const match = id.match(/^claude-([a-z]+)-(\d+)-(\d+)/)
  if (match === null) {
    return id
  }
  const [, family = '', major, minor] = match
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}.${minor}`
}

const formatDuration = (ms: number): string => {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) {
    return `${seconds}s`
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return `${minutes}m ${seconds % 60}s`
  }
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

const truncate = (text: string, width: number): string =>
  text.length <= width ? text : `${text.slice(0, Math.max(1, width - 1))}…`

// A path keeps its end, the folder you are in.
const truncateStart = (text: string, width: number): string =>
  text.length <= width ? text : `…${text.slice(text.length - Math.max(1, width - 1))}`

// What a tool call is about, in one short line: a path relative to the
// session, the first line of a command, a pattern, a query or a URL.
const targetOf = (input: unknown, cwd: string): string => {
  const fields = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  const text = (key: string) => (typeof fields[key] === 'string' ? (fields[key] as string) : undefined)

  const path = text('file_path') ?? text('notebook_path') ?? text('path')
  if (path !== undefined) {
    return cwd !== '' && path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path
  }
  const command = text('command')
  if (command !== undefined) {
    return command.split('\n')[0] ?? ''
  }
  return text('pattern') ?? text('query') ?? text('url') ?? text('description') ?? ''
}

export const register: Register = on => {
  let header: Header | null = null
  let sessionCwd = ''
  // Whether the pinned header was asked for; if not, the header becomes a row.
  let isPlaced = false
  let isPinned = false

  let status: Status | null = null
  let statusText = ''

  const crab: Crab = {
    acts: [],
    idle: null,
    isWorking: false,
    act: 0,
    step: 0,
    site: PINNED_REQUEST_ID,
    timer: null,
  }

  // True once, when the header should become a placed transcript row.
  const claimPlacement = (): boolean => {
    if (header === null || isPlaced || isPinned) {
      return false
    }
    isPlaced = true
    return true
  }

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    sessionCwd = e.cwd

    if (!e.isInteractive) {
      return result
    }

    const [version, model, home, runDir, folders] = await Promise.all([
      $.session.version(),
      $.session.model(),
      $.env.get('HOME'),
      $.env.get('CLAUDIO_RUN'),
      $.fs.list(`${$.plugin.root}/${CRAB_DIR}`).catch(() => []),
    ])
    const names = folders.filter(entry => entry.kind === 'dir').map(entry => entry.name).sort()
    const listed = await Promise.all(
      names.map(async name => {
        const files = await $.fs.list(`${$.plugin.root}/${CRAB_DIR}/${name}`).catch(() => [])
        return { name, act: actOf(name, files.map(file => file.name)) }
      }),
    )
    const drawn = listed.filter(one => one.act.frames.length > 0)
    crab.acts = drawn.filter(one => !isIdle(one.name)).map(one => one.act)
    crab.idle = drawn.find(one => isIdle(one.name))?.act ?? null
    crabPlays($, crab)
    const cwd = home && e.cwd.startsWith(home) ? `~${e.cwd.slice(home.length)}` : e.cwd
    header = { version: version.base ?? version.version, model: displayModel(model), cwd }

    if (runDir !== undefined) {
      $.clock.every(STATUS_POLL_MS, async () => {
        const text = await $.fs.read(`${runDir}/status.json`).catch(() => '')
        if (text === '' || text === statusText) {
          return
        }
        statusText = text
        status = parseStatus(text) ?? status
        $.ui.invalidate('ui.render')
      })
    }

    // The pinned header may have drawn blank before this point.
    $.ui.invalidate('ui.render')
    $.clock.after(PIN_WAIT_MS, () => {
      if (claimPlacement()) {
        void $.ui.place({ id: HEADER_ID }).catch(() => undefined)
      }
    })

    return result
  })

  // The crab works while the main loop does.
  on('turn.start', ($, e, next) => {
    if (e.agentId === undefined && !crab.isWorking) {
      crab.isWorking = true
      crab.act = 0
      crab.step = 0
      crabPlays($, crab)
    }
    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined && crab.isWorking) {
      crab.isWorking = false
      crab.step = 0
      crabShows($, crab)
      crabPlays($, crab)
    }
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    const hasVoices = (await $.env.get('CLAUDIO_VOICES')) === '1'
    const voice = hasVoices ? { ...VOICE, text: VOICE.text + SPOKEN } : VOICE
    return { sections: [...result.sections.filter(section => section.id !== VOICE.id), voice] }
  })

  // The header: the crab, then name, version, model, folder and branch, then
  // the session's figures (hooks/status.ts).
  on('ui.render', { component: 'Placed' }, ($, e, next) => {
    if (e.props.plugin !== 'claudio' || e.props.id !== HEADER_ID) {
      return next(e)
    }
    isPinned = isPinned || e.requestId === PINNED_REQUEST_ID
    crab.site = isPinned ? PINNED_REQUEST_ID : e.requestId
    if (header === null) {
      return next(e)
    }

    // Image is the terminal surface's element; Claudio lives in Ghostty.
    if (e.surface !== 'terminal') {
      return next(e)
    }

    const { Box, Image, Text } = $.ui.resolve(e)

    const width = Math.max(3, e.viewport?.columns ?? 80)
    const tiles = status === null ? [] : tilesOf(status)
    const shown = tiles.slice(0, tilesThatFit(width, CRAB.columns + 2 + NAME_COLUMNS, TILE_COLUMNS, tiles.length))
    const nameWidth = NAME_COLUMNS - 2

    const name = (
      <Box flexDirection="column" paddingLeft={2} width={NAME_COLUMNS + 2}>
        <Text>
          <Text bold>Claudio</Text>
          <Text dimColor> v{header.version}</Text>
        </Text>
        <Text>
          {(status === null ? [{ text: header.model, color: INK.yellow }] : modelPieces(status)).map((piece, index) => (
            <Text key={`model${index}`} color={piece.color}>
              {piece.text}
            </Text>
          ))}
        </Text>
        <Text>
          {pathPieces(truncateStart(status?.cwd || header.cwd, nameWidth)).map((piece, index) => (
            <Text key={`path${index}`} color={piece.color} bold={piece.bold === true}>
              {piece.text}
            </Text>
          ))}
        </Text>
        {status?.branch ? <Text color={INK.cyan}>{truncate(`ramo ${status.branch}`, nameWidth)}</Text> : null}
      </Box>
    )

    const figures = shown.map((tile, index) => (
      <Box key={`tile${index}`} flexDirection="column" width={TILE_COLUMNS}>
        <Text color={INK.dim}>{tile.label}</Text>
        <Text color={tile.value.color}>{tile.value.text}</Text>
        {tile.left === undefined ? (
          <Text> </Text>
        ) : (
          <Text>
            {gaugeOf(tile.left, GAUGE_CELLS).map((run, cell) => (
              <Text key={`run${cell}`} color={run.color}>
                {run.text}
              </Text>
            ))}
          </Text>
        )}
        <Text>
          {tile.detail.map((piece, part) => (
            <Text key={`detail${part}`} color={piece.color}>
              {piece.text}
            </Text>
          ))}
        </Text>
      </Box>
    ))

    // The crab stands in front of the rule: it starts where he ends.
    const ruled = Math.max(3, width - CRAB.columns)
    const third = Math.floor(ruled / 3)
    const isBar = e.requestId === PINNED_REQUEST_ID

    return (
      <Box flexDirection="row" height={HEADER_ROWS} overflow="hidden" marginY={isBar ? 0 : 1}>
        <Image
          key={CRAB_KEY}
          source={{ file: `${$.plugin.root}/${crabFile(crab)}`, format: 'png' }}
          columns={CRAB.columns}
          rows={CRAB.rows}
          alt="Claudio"
        />
        <Box flexDirection="column">
          <Box flexDirection="row" height={HEADER_ROWS - 1}>
            {name}
            {figures}
          </Box>
          {isBar ? (
            <Text>
              <Text color={FLAG.green}>{'─'.repeat(third)}</Text>
              <Text color={FLAG.white}>{'─'.repeat(third)}</Text>
              <Text color={FLAG.red}>{'─'.repeat(ruled - 2 * third)}</Text>
            </Text>
          ) : null}
        </Box>
      </Box>
    )
  })

  // Your prompt: a tiny tricolore in place of the grey block.
  on('ui.render', { component: 'UserMessage' }, ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.origin.kind !== 'composer' || e.props.isExpanded) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="row">
        <Text color={FLAG.green}>▎</Text>
        <Text color={FLAG.white}>▎</Text>
        <Text color={FLAG.red}>▎</Text>
        <Text bold> {e.props.text}</Text>
      </Box>
    )
  })

  // A reply opens with 🤌 instead of the bullet (summaries too; the engine's
  // faint "· summary" mark stays inside the body it draws).
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || !e.props.isFirstOfReply) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const body = await next({ ...e, props: { ...e.props, isFirstOfReply: false } })

    // The engine's block opens with a blank row; the hand sits on the text row.
    return (
      <Box flexDirection="row">
        <Box marginTop={1} marginRight={1}>
          <Text>🤌</Text>
        </Box>
        {body}
      </Box>
    )
  })

  // One quiet line per tool call: mark, Italian verb, target.
  on('ui.render', { component: 'ToolUse' }, ($, e, next) => {
    const verb = verbOf(e.props.tool)
    if (e.surface !== 'terminal' || e.props.isExpanded || verb === undefined) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const mark = markOf(e.props)
    const width = Math.max(20, (e.viewport?.columns ?? 80) - 16)
    const target = e.props.tool.startsWith('mcp__')
      ? mcpLabel(e.props.tool)
      : targetOf(e.props.input, sessionCwd)

    return (
      <Box flexDirection="row">
        <Text color={mark.color}>{mark.glyph} </Text>
        <Text dimColor>{verb.padEnd(9)}</Text>
        <Text>{truncate(target, width)}</Text>
      </Box>
    )
  })

  // Folded runs of calls ("Read 1 file", "Called plugin:…") as the same
  // quiet lines, one per call. A group that says it holds more than calls
  // keeps the engine's; the terminal leaves isCallsOnly out, so absent counts
  // as calls only (verified 2026-11-22: the group drew stock otherwise).
  on('ui.render', { component: 'ToolGroup' }, ($, e, next) => {
    if (
      e.surface !== 'terminal' ||
      e.props.isExpanded ||
      e.props.isCallsOnly === false ||
      e.props.calls.some(call => verbOf(call.tool) === undefined)
    ) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const width = Math.max(20, (e.viewport?.columns ?? 80) - 16)

    return (
      <Box flexDirection="column">
        {e.props.calls.map((call, index) => {
          const mark = markOf(call)
          const target = call.tool.startsWith('mcp__') ? mcpLabel(call.tool) : targetOf(call.input, sessionCwd)
          return (
            <Box key={`call${index}`} flexDirection="row">
              <Text color={mark.color}>{mark.glyph} </Text>
              <Text dimColor>{(verbOf(call.tool) ?? call.tool).padEnd(9)}</Text>
              <Text>{truncate(target, width)}</Text>
            </Box>
          )
        })}
      </Box>
    )
  })

  on('ui.render', { component: 'ToolResult' }, ($, e, next) => {
    if (
      e.surface !== 'terminal' ||
      e.props.isExpanded ||
      e.props.isErrored ||
      !QUIET_RESULTS.has(e.props.tool)
    ) {
      return next(e)
    }

    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  // While working: a waving tricolore beside the Italian word (hooks/flag.tsx).
  // It replaces the whole row, so the engine's token count is not shown.
  on('ui.render', { component: 'Spinner' }, ($, e, next) => {
    const word = pick(WORKING, e.props.word)
    if (e.surface !== 'terminal') {
      return next({ ...e, props: { ...e.props, word } })
    }

    const { Client } = $.ui.resolve(e)
    return <Client key="flag" module="./flag.tsx" props={{ text: e.props.message ?? word, suffix: e.props.suffix }} />
  })

  // The turn closes with a thin rule: 🍕 Sfornato in 12s ─────
  on('ui.render', { component: 'TurnDuration' }, ($, e, next) => {
    const word = pick(DONE, e.props.word)
    if (e.surface !== 'terminal' || e.props.isExpanded || e.props.waitingFor !== undefined) {
      return next({ ...e, props: { ...e.props, word } })
    }

    const { Text } = $.ui.resolve(e)
    const label = `🍕 ${word} in ${formatDuration(e.props.durationMs)} `
    const rule = '─'.repeat(Math.max(0, Math.min(e.viewport?.columns ?? 60, 60) - label.length - 1))

    return (
      <Text dimColor>
        {label}
        {rule}
      </Text>
    )
  })
}
