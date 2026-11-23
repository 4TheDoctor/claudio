#!/usr/bin/env node
// Installs Claudio for this user. Nothing outside the home folder is touched,
// and plain `claude` keeps working as it was.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'

const HELP = `Claudio, an unofficial Italian mode for Claude Code.

  claudio-install               install or update; asks about the patches
  claudio-install --patches     install with the optional patches
  claudio-install --no-patches  install without them, asking nothing
  claudio-install uninstall     remove the claudio command, its theme and files
  claudio-install --help        show this

CLAUDIO_HOME changes where the files go (default: ~/.claude/claudio).`

const NOTICE = `OPTIONAL PATCHES

  They change a private copy of your own Claude Code, kept in Claudio's folder:
  the prompt box in the Italian flag's colours, the header pinned at the top,
  and no stock banner. Your normal "claude" is not changed. The copy takes
  about 400 MB, and as much again for its backup.

  Read this first:
  - Anthropic does not make, support or approve them. Its terms restrict
    reverse engineering its software: read the terms that apply to your account
    and decide for yourself. Using them could affect your account.
  - They are for personal use. Nobody earns anything from Claudio.
  - They come with no warranty. The authors are not responsible for anything
    that happens from using them.
  - A Claude Code update can stop them from fitting.

  Claudio works without them: the header becomes a normal row of the chat.`

const source = dirname(fileURLToPath(import.meta.url))
const home = homedir()
const target = resolve(process.env.CLAUDIO_HOME ?? join(home, '.claude', 'claudio'))
const marker = join(target, '.installed.json')
const command = join(home, '.local', 'bin', 'claudio')
const theme = join(home, '.claude', 'themes', 'claudio.json')

const say = (word, text) => console.log(`${word.padEnd(11)}${text}`)
const fail = text => {
  console.error(`claudio-install: ${text}`)
  process.exit(1)
}
const exists = path => fs.lstatSync(path, { throwIfNoEntry: false }) !== undefined
const has = name =>
  (process.env.PATH ?? '').split(delimiter).some(dir => {
    try {
      fs.accessSync(join(dir, name), fs.constants.X_OK)
      return true
    } catch {
      return false
    }
  })
const isLinkTo = (link, to) =>
  fs.lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink() === true &&
  resolve(dirname(link), fs.readlinkSync(link)) === to

// The files this package brings, one entry per line of package.json's "files".
const manifest = JSON.parse(fs.readFileSync(join(source, 'package.json'), 'utf8'))
const owned = ['package.json', ...manifest.files]

const patchesSum = () => {
  const dir = join(source, 'patches')
  const hash = createHash('sha256')
  for (const name of fs.readdirSync(dir).sort()) hash.update(name).update(fs.readFileSync(join(dir, name)))
  return hash.digest('hex')
}

const copyFiles = () => {
  if (source === target) {
    say('USE', target)
    return
  }
  if (exists(join(target, '.git'))) {
    fail(`${target} is a git checkout. Run "node cli.mjs" inside it instead.`)
  }
  if (exists(target) && !exists(marker) && fs.readdirSync(target).length > 0) {
    fail(`${target} exists and was not made by this installer. Move it away first.`)
  }
  say(exists(marker) ? 'UPDATE' : 'INSTALL', target)
  const before = exists(marker) ? JSON.parse(fs.readFileSync(marker, 'utf8')) : { files: [] }
  // The patcher is set up again when the patches it carries have changed.
  if (before.patches !== patchesSum()) fs.rmSync(join(target, 'vendor'), { recursive: true, force: true })
  for (const path of before.files) {
    fs.rmSync(join(target, path), { recursive: true, force: true })
  }
  for (const path of owned) {
    fs.cpSync(join(source, path), join(target, path), { recursive: true })
  }
  for (const path of ['claudio', 'cli.mjs', 'apply-banner.sh']) {
    fs.chmodSync(join(target, path), 0o755)
  }
  fs.writeFileSync(marker, `${JSON.stringify({ version: manifest.version, patches: patchesSum(), files: owned }, null, 2)}\n`)
}

// A file that is not ours is kept beside the link, never overwritten.
const linkCommand = () => {
  const launcher = join(target, 'claudio')
  fs.mkdirSync(dirname(command), { recursive: true })
  if (exists(command) && !isLinkTo(command, launcher)) {
    const kept = `${command}.before-claudio`
    if (exists(kept)) fail(`${command} and ${kept} both exist. Move one away first.`)
    fs.renameSync(command, kept)
    say('KEPT', `your old command as ${kept}`)
  }
  if (!exists(command)) fs.symlinkSync(launcher, command)
  say('COMMAND', command)
}

const copyTheme = () => {
  fs.mkdirSync(dirname(theme), { recursive: true })
  fs.copyFileSync(join(target, 'install', 'claudio-theme.json'), theme)
  say('THEME', theme)
}

const wantsPatches = async flags => {
  if (flags.has('--no-patches')) return false
  if (!flags.has('--patches') && !process.stdin.isTTY) {
    say('PATCHES', 'skipped: nobody to ask. Add --patches to install them.')
    return false
  }
  console.log(`\n${NOTICE}\n`)
  if (flags.has('--patches')) return true
  const ask = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await ask.question('Install the optional patches? Type yes to install them [no]: ')
  ask.close()
  return /^(y|yes|s|si|sí)$/i.test(answer.trim())
}

const applyPatches = () => {
  if (!has('git')) fail('the patches need git. Everything else is installed.')
  const { status } = spawnSync('bash', [join(target, 'apply-banner.sh')], { stdio: 'inherit' })
  if (status !== 0) fail('the patches did not go in (see above). Claudio works without them.')
}

const install = async flags => {
  if (!has('claude')) fail('Claude Code is not installed. See https://code.claude.com/docs')
  copyFiles()
  linkCommand()
  copyTheme()
  if (await wantsPatches(flags)) applyPatches()
  const onPath = (process.env.PATH ?? '').split(delimiter).includes(dirname(command))
  say('DONE', onPath ? 'Type claudio in any folder.' : `Add ${dirname(command)} to your PATH, then type claudio.`)
}

const uninstall = () => {
  const launcher = join(target, 'claudio')
  if (isLinkTo(command, launcher)) {
    fs.rmSync(command)
    say('REMOVED', command)
    if (exists(`${command}.before-claudio`)) {
      fs.renameSync(`${command}.before-claudio`, command)
      say('RESTORED', command)
    }
  }
  if (exists(theme)) {
    fs.rmSync(theme)
    say('REMOVED', theme)
  }
  if (!exists(marker)) {
    say('LEFT', `${target}: not made by this installer`)
    return
  }
  const { files } = JSON.parse(fs.readFileSync(marker, 'utf8'))
  for (const path of [...files, '.installed.json', 'bin', 'tweakcc', 'vendor', 'mod/.claude-plugin/types']) {
    fs.rmSync(join(target, path), { recursive: true, force: true })
  }
  // What is left is the person's own; an empty folder goes too.
  const prune = dir => {
    if (!exists(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) prune(join(dir, entry.name))
    }
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
  }
  prune(target)
  // So that a later install knows the folder and does not refuse it.
  if (exists(target)) fs.writeFileSync(marker, `${JSON.stringify({ files: [] })}\n`)
  say(exists(target) ? 'LEFT' : 'REMOVED', exists(target) ? `${target}: your own files` : target)
}

const args = process.argv.slice(2)
const flags = new Set(args.filter(arg => arg.startsWith('-')))
const [verb = 'install', ...rest] = args.filter(arg => !arg.startsWith('-'))
const unknown = [...flags].find(flag => !['--patches', '--no-patches', '--help', '-h'].includes(flag))

if (flags.has('--help') || flags.has('-h')) console.log(HELP)
else if (unknown !== undefined || rest.length > 0 || !['install', 'uninstall'].includes(verb)) {
  fail(`unknown option ${unknown ?? rest[0] ?? verb}\n\n${HELP}`)
} else if (flags.has('--patches') && flags.has('--no-patches')) fail('choose --patches or --no-patches')
else if (process.platform === 'win32') fail('Claudio runs on macOS and Linux.')
else if (verb === 'uninstall') uninstall()
else await install(flags)
