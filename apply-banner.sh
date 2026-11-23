#!/usr/bin/env bash
# Patch Claudio's copy of Claude Code: hide the stock startup banner, draw
# the prompt's rules as an Italian flag that scrolls while Claude works, and
# pin the mod's header above the transcript in fullscreen.
#
# Uses tweakcc built from source: main (b026fb5) has the native-patching fix
# for Claude Code 2.1.327+ (bytecode invalidation), the npm 4.4.0 release
# does not. The tricolor prompt and the pinned header are Claudio's own
# patches, kept in patches/ and applied on top of b026fb5 on the checkout's
# `claudio` branch. The first run downloads tweakcc and sets that up. Only
# bin/claude, a copy, is patched. tweakcc keeps the original as
# tweakcc/native-binary.backup and restores from it before every apply, so
# running this again is safe. Re-run after each Claude Code update.
#
# A watchdog stops tweakcc if it passes LIMIT_GB of RAM (default 8), so it
# cannot freeze the Mac like the npm build did.
set -euo pipefail

C="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$C/vendor/tweakcc"
TWEAKCC_URL="https://github.com/Piebald-AI/tweakcc.git"
TWEAKCC_COMMIT="b026fb55b2e85c9cfd92030e4175227030314152"
PNPM=(pnpm)
command -v pnpm >/dev/null 2>&1 || PNPM=(npx --yes pnpm@12.21.0)
LIMIT_GB="${LIMIT_GB:-8}"
PATCHES="hide-startup-banner,claudio-tricolor,claudio-header"

# After a Claude Code update, start from the new build: copy it in and drop
# tweakcc's backup, which would otherwise restore the old build. bin/SOURCE
# records which build the copy came from.
ORIGINAL="$(readlink "$HOME/.local/bin/claude" 2>/dev/null || true)"
if [[ -z "$ORIGINAL" || ! -f "$ORIGINAL" ]]; then
  echo "apply: this needs Claude Code's native install (a link at ~/.local/bin/claude)." >&2
  echo "       Claudio still works without it, with the mod alone." >&2
  exit 1
fi
mkdir -p "$C/bin" "$C/tweakcc"
if [[ "$(cat "$C/bin/SOURCE" 2>/dev/null)" != "$ORIGINAL" ]]; then
  echo "COPY       $ORIGINAL"
  cp "$ORIGINAL" "$C/bin/claude.new"
  chmod +x "$C/bin/claude.new"
  mv "$C/bin/claude.new" "$C/bin/claude"
  rm -f "$C/tweakcc/native-binary.backup"
fi

# First run: tweakcc at the commit the patches were written for, plus them.
if [[ ! -d "$SRC/.git" ]]; then
  echo "DOWNLOAD   tweakcc $TWEAKCC_COMMIT"
  mkdir -p "$(dirname "$SRC")"
  git clone --quiet "$TWEAKCC_URL" "$SRC"
  git -C "$SRC" switch --quiet -c claudio "$TWEAKCC_COMMIT"
  git -C "$SRC" -c user.name=claudio -c user.email=claudio@localhost am --quiet "$C"/patches/*.patch
fi
if [[ ! -f "$C/tweakcc/config.json" ]]; then
  echo '{ "settings": { "misc": { "hideStartupBanner": true } } }' > "$C/tweakcc/config.json"
fi

# Rebuild tweakcc whenever its source changed since the last build: the
# commit plus the contents of every modified or new file under src/.
fingerprint() {
  (
    cd "$SRC"
    git rev-parse HEAD
    git ls-files -m -o --exclude-standard src | sort | while read -r f; do
      echo "$f"
      cat "$f"
    done
  ) | shasum | cut -d' ' -f1
}
STAMP="$SRC/dist/.claudio-fingerprint"
want="$(fingerprint)"
if [[ ! -f "$SRC/dist/index.mjs" || "$(cat "$STAMP" 2>/dev/null)" != "$want" ]]; then
  echo "BUILD      tweakcc $(git -C "$SRC" log -1 --format='%h %ad' --date=short) + Claudio's patches"
  (cd "$SRC" && HUSKY=0 "${PNPM[@]}" install --frozen-lockfile && "${PNPM[@]}" run build)
  echo "$want" > "$STAMP"
fi

echo "APPLY      $PATCHES on $C/bin/claude"
echo "WATCHDOG   stops tweakcc above ${LIMIT_GB} GB of RAM"
TWEAKCC_CC_INSTALLATION_PATH="$C/bin/claude" TWEAKCC_CONFIG_DIR="$C/tweakcc" \
  node "$SRC/dist/index.mjs" --apply --patches "$PATCHES" -y > >(tee "$C/tweakcc/apply.log") 2>&1 &
pid=$!

while kill -0 "$pid" 2>/dev/null; do
  rss_kb="$(ps -o rss= -p "$pid" 2>/dev/null | tr -d ' ')"
  if (( ${rss_kb:-0} > LIMIT_GB * 1024 * 1024 )); then
    echo "STOPPED    tweakcc passed ${LIMIT_GB} GB of RAM and was killed" >&2
    kill "$pid"
    exit 1
  fi
  sleep 1
done
wait "$pid"
echo "$ORIGINAL" > "$C/bin/SOURCE"

# A Claude Code newer than the patches can leave some without a match. The
# program still runs; the mod draws its header as a normal row without them.
sleep 1
echo
while IFS='|' read -r name modules; do
  if grep -q "$name: Updated $modules module" "$C/tweakcc/apply.log"; then
    echo "IN         $name"
  else
    echo "NOT IN     $name: it does not fit this Claude Code version"
  fi
done <<'LIST'
Hide startup banner|1
Claudio tricolor prompt|2
Claudio pinned header|2
LIST
echo "DONE       Now run: claudio"
