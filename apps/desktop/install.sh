#!/bin/sh
# Installs the GTM Factory Mac app from the latest GitHub release.
#
#   curl -fsSL https://raw.githubusercontent.com/distribute-you/gtm-factory/main/apps/desktop/install.sh | sh
#
# The app is not notarized by Apple, so it is installed from Terminal: the download is
# unzipped into /Applications and its quarantine flag cleared, so macOS opens it directly.
#
# Every command reads /dev/null, never stdin: under `curl | sh`, stdin is this script.
# DRY_RUN=1 prints every step without changing anything.
# GTMF_VERSION=desktop-v0.1.0 installs that release instead of the latest one.
set -eu

REPO="distribute-you/gtm-factory"
ASSET="GTM-Factory-mac.zip"
APP_NAME="GTM Factory.app"
DRY_RUN="${DRY_RUN:-0}"

say() { printf '%s\n' "$*"; }
fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }
run() {
  if [ "$DRY_RUN" = "1" ]; then
    printf '+ %s\n' "$*"
  else
    "$@" </dev/null
  fi
}

[ "$(uname -s)" = "Darwin" ] || fail "GTM Factory for desktop runs on macOS only."
command -v curl >/dev/null 2>&1 || fail "curl is missing."

# 1. The release: the newest desktop-v* tag, unless one is asked for.
TAG="${GTMF_VERSION:-}"
if [ -z "$TAG" ]; then
  TAG=$(curl -fsSL "https://api.github.com/repos/$REPO/releases?per_page=50" \
    | grep -o '"tag_name": *"desktop-v[^"]*"' \
    | head -n 1 \
    | sed 's/.*"\(desktop-v[^"]*\)"/\1/') || true
fi
[ -n "$TAG" ] || fail "no GTM Factory desktop release found on https://github.com/$REPO/releases"
URL="https://github.com/$REPO/releases/download/$TAG/$ASSET"
say "GTM Factory $TAG"
say "Download: $URL"

# 2. Where it goes: /Applications, or ~/Applications when /Applications is not writable.
DEST_DIR="/Applications"
if [ ! -w "$DEST_DIR" ]; then
  DEST_DIR="$HOME/Applications"
  run mkdir -p "$DEST_DIR"
fi
DEST="$DEST_DIR/$APP_NAME"
say "Install to: $DEST"

# 3. Download and unzip into a temporary folder.
TMP=$(mktemp -d "${TMPDIR:-/tmp}/gtm-factory.XXXXXX")
trap 'rm -rf "$TMP"' EXIT INT TERM
run curl -fL --progress-bar -o "$TMP/$ASSET" "$URL"
run ditto -x -k "$TMP/$ASSET" "$TMP/unzipped"
if [ "$DRY_RUN" != "1" ] && [ ! -d "$TMP/unzipped/$APP_NAME" ]; then
  fail "the download does not hold $APP_NAME"
fi

# 4. Replace any older copy, then clear the quarantine flag so macOS opens it directly.
if [ "$DRY_RUN" = "1" ] || [ -d "$DEST" ]; then
  run osascript -e 'quit app "GTM Factory"' 2>/dev/null || true
  run rm -rf "$DEST"
fi
run ditto "$TMP/unzipped/$APP_NAME" "$DEST"
run xattr -dr com.apple.quarantine "$DEST"

# 5. The app writes with your own Claude subscription, through the claude CLI.
CLAUDE=""
for c in "$HOME/.local/bin/claude" "$HOME/.claude/local/claude" /opt/homebrew/bin/claude /usr/local/bin/claude; do
  if [ -x "$c" ]; then CLAUDE="$c"; break; fi
done
if [ -z "$CLAUDE" ]; then
  CLAUDE=$("${SHELL:-/bin/zsh}" -lc 'command -v claude' </dev/null 2>/dev/null || true)
fi
if [ -z "$CLAUDE" ]; then
  say ""
  say "One more thing: GTM Factory writes with your own Claude subscription."
  say "Install Claude Code from https://claude.com/claude-code, then in Terminal run:"
  say "  claude"
  say "and type /login."
elif "$CLAUDE" auth status </dev/null 2>/dev/null | grep -q '"loggedIn": *true'; then
  say "Claude: ready ($CLAUDE)"
else
  say ""
  say "One more thing: log in to Claude so GTM Factory can write with your subscription."
  say "In Terminal run:"
  say "  claude"
  say "and type /login."
fi

# 6. Open it.
run open "$DEST"
say "Done. GTM Factory is in $DEST_DIR."
