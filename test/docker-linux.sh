#!/bin/sh
# Linux verification in a throw-away container (does not touch other containers). Needs a running docker engine.
# Usage: sh test/docker-linux.sh [image]   (default node:22-bookworm-slim; use debian:bookworm-slim to test the no-Node path)
set -eu
IMG=${1:-node:22-bookworm-slim}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
docker run --rm --name "crew-linux-test-$$" -v "$ROOT:/src:ro" "$IMG" sh -c '
  set -e
  command -v curl >/dev/null || (apt-get update -qq && apt-get install -y -qq curl ca-certificates xz-utils >/dev/null)
  useradd -m tester; cp -r /src /home/tester/pkg; chown -R tester /home/tester/pkg
  su tester -c "cd ~/pkg && node --test test/*.test.js 2>&1 | tail -8 || true"
  su tester -c "sh ~/pkg/install.sh --no-cli && . ~/.profile; ~/.free-agent-crew/bin/crew doctor --quick; ~/.free-agent-crew/bin/crew version"
'
