#!/bin/sh
# free-agent-crew installer for macOS / Linux. Idempotent: safe to run again (upgrade/repair).
# Usage: sh install.sh [--no-cli] [--no-path] [--no-skills] [--upgrade] [--registry URL] [--force] [--tray] [--uninstall-tray]
# Only bootstraps Node; every other step is the cross-platform Node implementation (crew setup).
set -eu
SRC=$(cd "$(dirname "$0")" && pwd)
CREW_HOME=${CREW_HOME:-"$HOME/.free-agent-crew"}
APP="$CREW_HOME/app"
NODE_MIN=18
say() { printf '%s\n' "$*"; }

node_ok() { # $1 node binary -> 0 if version >= NODE_MIN
  [ -x "$1" ] || return 1
  v=$("$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null </dev/null) || return 1
  [ "${v:-0}" -ge "$NODE_MIN" ] 2>/dev/null
}
find_node() {
  _ifs=$IFS; IFS='
'  # one candidate per line: paths with spaces stay whole
  for c in "$(command -v node 2>/dev/null || true)" "$CREW_HOME/node/bin/node" /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node \
           "$HOME/.volta/bin/node" $(ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -rV 2>/dev/null || true); do
    [ -n "$c" ] && node_ok "$c" && { IFS=$_ifs; printf '%s' "$c"; return 0; }
  done
  IFS=$_ifs; return 1
}
fetch() { # url out
  if command -v curl >/dev/null 2>&1; then curl -fsSL --connect-timeout 10 -m 600 -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then wget -q -T 30 -O "$2" "$1"
  else say "需要 curl 或 wget"; return 1; fi
}
install_portable_node() {
  os=$(uname -s | tr 'A-Z' 'a-z'); arch=$(uname -m)
  case "$arch" in x86_64|amd64) arch=x64 ;; arm64|aarch64) arch=arm64 ;; armv7l) arch=armv7l ;; *) say "不支持的 CPU: $arch"; return 1 ;; esac
  case "$os" in darwin|linux) ;; *) say "不支持的系统: $os"; return 1 ;; esac
  tmp=$(mktemp -d)
  # CREW_NODE_MIRROR=<base url of a latest-v22.x dir> is tried first (e.g. a company mirror); curl/wget honour HTTPS_PROXY
  for base in ${CREW_NODE_MIRROR:-} https://nodejs.org/dist/latest-v22.x https://npmmirror.com/mirrors/node/latest-v22.x; do
    say "下载便携 Node 22 ($os-$arch) from $base ..."
    if fetch "$base/SHASUMS256.txt" "$tmp/sums" 2>/dev/null; then
      f=$(grep -o "node-v[0-9.]*-$os-$arch\.tar\.gz" "$tmp/sums" | head -1)
      if [ -n "$f" ] && fetch "$base/$f" "$tmp/$f"; then
        want=$(grep " $f\$" "$tmp/sums" | cut -d' ' -f1)
        got=$( (command -v shasum >/dev/null && shasum -a 256 "$tmp/$f" || sha256sum "$tmp/$f") | cut -d' ' -f1)
        if [ "$want" = "$got" ]; then
          rm -rf "$CREW_HOME/node.new"; mkdir -p "$CREW_HOME/node.new"
          tar -xzf "$tmp/$f" -C "$CREW_HOME/node.new" --strip-components 1
          rm -rf "$CREW_HOME/node"; mv "$CREW_HOME/node.new" "$CREW_HOME/node"; rm -rf "$tmp"; return 0
        fi
        say "校验失败，换源重试"
      fi
    fi
  done
  rm -rf "$tmp"; return 1
}

mkdir -p "$CREW_HOME"
if [ "${CREW_FORCE_PORTABLE_NODE:-0}" = 1 ]; then NODE=""; else NODE=$(find_node || true); fi
if [ -z "$NODE" ]; then
  say "没有找到 Node >= $NODE_MIN（cline/kilo/opencode 都需要 Node）。"
  if [ "${CREW_FORCE_PORTABLE_NODE:-0}" != 1 ] && [ "$(uname -s)" = Darwin ] && command -v brew >/dev/null 2>&1; then say "用 Homebrew 安装 node ..."; brew install node || true; NODE=$(find_node || true); fi
  if [ -z "$NODE" ]; then install_portable_node || { say "❌ 自动安装 Node 失败。请手动安装 Node 20+ 后重跑。"; exit 1; }; NODE="$CREW_HOME/node/bin/node"; fi
fi
say "Node: $NODE ($("$NODE" -v </dev/null))"
# npm must come from the same Node (portable Node ships its own)
PATH="$(dirname "$NODE"):$PATH"; export PATH

if [ "$SRC" != "$APP" ]; then
  rm -rf "$APP.new"; mkdir -p "$APP.new"
  (cd "$SRC" && tar cf - --exclude ./.git . ) | (cd "$APP.new" && tar xf -)
  rm -rf "$APP.old"; [ -d "$APP" ] && mv "$APP" "$APP.old"; mv "$APP.new" "$APP"; rm -rf "$APP.old"
fi
CREW_HOME="$CREW_HOME" "$NODE" "$APP/bin/crew.js" setup "$@" </dev/null
say ""
CREW_HOME="$CREW_HOME" "$NODE" "$APP/bin/crew.js" doctor --quick </dev/null || true
say ""
say "不依赖 PATH 的调用方式: \"$NODE\" \"$APP/bin/crew.js\" doctor"
