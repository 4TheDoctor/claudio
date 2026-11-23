# Claudio

An unofficial Italian mode for Claude Code. Type `claudio` instead of `claude`
and you get a pizzaiolo crab that moves while Claude works, the session's
figures beside him, Italian working words, and a Claude who talks like an
Italian who has lived in Spain for years. It is an affectionate joke
among friends.

Claudio is not made, supported or approved by Anthropic. It is free, for
personal use, and nobody earns anything from it.

## Install

You need [Claude Code](https://code.claude.com/docs), Node 20 or newer, and
macOS or Linux. The crab is a picture in Ghostty, kitty and iTerm2; other
terminals show his name.

```
npx github:4TheDoctor/claudio
```

Run the same line to update. It puts the files in `~/.claude/claudio`, a theme
in `~/.claude/themes`, and the `claudio` command in `~/.local/bin`. Plain
`claude` is untouched.

To remove it all:

```
npx github:4TheDoctor/claudio uninstall
```

## The optional patches

The installer asks whether to install them, and the answer is no unless you
say yes. They draw the prompt box as an Italian flag that scrolls while Claude
works, pin the header at the top, and hide the stock banner. To do that they
build [tweakcc](https://github.com/Piebald-AI/tweakcc) on your computer and
change a private copy of your own Claude Code. No part of Claude Code is
distributed here.

- Anthropic's terms restrict reverse engineering its software. Read the terms
  that apply to your account and decide for yourself. Using the patches could
  affect your account.
- They come with no warranty, and the authors are not responsible for anything
  that happens from using them.
- They were written for Claude Code 2.1.330. A newer one may not fit; the
  installer says which pieces went in.

After a Claude Code update, run the install line again and say yes.

## Make it yours

- **The crab.** Each folder in `mod/art/crab` is one act: frames named `00.png`,
  `01.png`, and so on. `gesture@170` holds each frame 170 ms. Acts take turns,
  about four seconds each. `tools/build-crab-frames.py` makes them from a GIF or
  a folder of PNGs. An update replaces `mod`, so keep your own acts elsewhere.
- **The voices.** If you use VoiceMode and have voices named `claudio-festa`,
  `claudio-tragedia`, `claudio-chiacchiera` and `claudio-racconto`, put
  `CLAUDIO_VOICES=1` in `~/.claude/claudio/local.env`.

## Credits

The crab began as an image made with Adobe Firefly and was redrawn by hand. The
patches are built with tweakcc, by Piebald LLC, under the MIT license.

MIT license, see [LICENSE](LICENSE).
