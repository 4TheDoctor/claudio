#!/usr/bin/env node
// Claudio's status line command. Claude Code pipes it the JSON it gives any
// status line; this keeps the figures in $CLAUDIO_RUN/status.json for the mod,
// which draws them in the header, and prints nothing, so the row under the
// prompt stays empty.
//
// Every figure is Claude Code's own. "left" is 100 minus its used percentage.
// Without $CLAUDIO_RUN (set by the claudio launcher) it does nothing.
import { execFileSync } from 'node:child_process'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const run = process.env.CLAUDIO_RUN
if (!run) process.exit(0)

let input
try {
  input = JSON.parse(readFileSync(0, 'utf8'))
} catch {
  process.exit(0)
}

const DAYS = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab']
const two = n => String(n).padStart(2, '0')
const clock = date => `${two(date.getHours())}:${two(date.getMinutes())}`
const dayClock = date => `${DAYS[date.getDay()]} ${clock(date)}`
const left = used => Math.max(0, 100 - used)

const limit = (window, format) =>
  typeof window?.used_percentage !== 'number'
    ? null
    : {
        left: Math.round(left(window.used_percentage)),
        resets: typeof window.resets_at === 'number' ? format(new Date(window.resets_at * 1000)) : null,
      }

const cwd = input.cwd ?? input.workspace?.current_dir ?? ''
let branch = null
if (cwd) {
  try {
    branch =
      execFileSync('git', ['-C', cwd, '--no-optional-locks', 'rev-parse', '--abbrev-ref', 'HEAD'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 2000,
      }).trim() || null
  } catch {
    // Not a git folder, or no commit yet.
  }
}

const size = input.context_window?.context_window_size ?? 0
const tokens = input.context_window?.total_input_tokens ?? 0
const home = homedir()

const status = {
  model: (input.model?.display_name ?? '').replace(' (1M context)', ' 1M'),
  effort: input.effort?.level ?? null,
  fast: input.fast_mode ?? false,
  agent: input.agent?.name ?? null,
  cwd: cwd === home || cwd.startsWith(`${home}/`) ? `~${cwd.slice(home.length)}` : cwd,
  branch,
  context: size > 0 ? { left: Math.floor(left((tokens * 100) / size)), tokens, window: size } : null,
  fiveHour: limit(input.rate_limits?.five_hour, clock),
  sevenDay: limit(input.rate_limits?.seven_day, dayClock),
  cost: input.cost?.total_cost_usd ?? 0,
  added: input.cost?.total_lines_added ?? 0,
  removed: input.cost?.total_lines_removed ?? 0,
}

const file = join(run, 'status.json')
writeFileSync(`${file}.new`, JSON.stringify(status))
renameSync(`${file}.new`, file)
