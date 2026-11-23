import type { ClientModule } from 'claude-code'

// The spinner row while Claudio works: a tricolore that waves, the Italian
// word, and the seconds since the row appeared. Runs on the terminal's
// drawing thread with its own frame clock, so it moves without the engine
// redrawing anything.

type Props = { text: string; suffix: string }
type State = { frame: number; startedAt: number | null }

const STRIPES = [
  '#009246', '#009246', '#009246',
  '#F1F2F1', '#F1F2F1', '#F1F2F1',
  '#CE2B37', '#CE2B37', '#CE2B37',
] as const

// Lower blocks, shortest to tallest: one column of the flag each.
const HEIGHTS = ['▃', '▄', '▅', '▆', '▇'] as const

const FRAME_MS = 110

const wallClock = (): number | null => (typeof Date === 'undefined' ? null : Date.now())

const Flag: ClientModule<Props, State> = (props, surface) => {
  if (surface.state === undefined) {
    surface.setState({ frame: 0, startedAt: wallClock() })
    surface.every(FRAME_MS, () => {
      const state = surface.state
      surface.setState({ frame: (state?.frame ?? 0) + 1, startedAt: state?.startedAt ?? null })
    })
  }

  const frame = surface.state?.frame ?? 0
  const startedAt = surface.state?.startedAt ?? null
  const now = wallClock()
  const seconds = startedAt === null || now === null ? null : Math.floor((now - startedAt) / 1000)
  const { Box, Text } = surface.elements

  // A wave travelling left to right across the nine columns.
  const columns = STRIPES.map((color, x) => {
    const level = Math.round(2 + 2 * Math.sin(frame * 0.55 - x * 0.75))
    return (
      <Text key={`c${x}`} color={color}>
        {HEIGHTS[Math.min(HEIGHTS.length - 1, Math.max(0, level))]}
      </Text>
    )
  })

  return (
    <Box flexDirection="row">
      {columns}
      <Text color="claude">
        {' '}
        {props.text}
        {props.suffix}
      </Text>
      {seconds === null ? null : <Text dimColor> {seconds}s</Text>}
    </Box>
  )
}

export default Flag
