#!/usr/bin/env bash
# Install the official, pinned Compact toolchain on a GitHub Linux runner.
set -euo pipefail

[[ "$(uname -s)" == 'Linux' ]] || { printf '%s\n' 'This installer requires Linux.' >&2; exit 1; }
installer="${RUNNER_TEMP:?Run on a GitHub Actions runner}/donations-compact-installer.sh"
curl --proto '=https' --tlsv1.2 --fail --location --silent --show-error \
  'https://github.com/midnightntwrk/compact/releases/download/compact-v0.5.1/compact-installer.sh' \
  --output "$installer"
# Official compact-v0.5.1 release installer digest, also pinned by Midnight BallotLab.
printf '%s  %s\n' '85e74a53ae4a67b31fa4d854f3b6ffb4c29f7c53e3372c5008b6a4729a8b4a73' "$installer" | sha256sum --check --strict
sh "$installer"
export PATH="$HOME/.local/bin:$PATH"
printf '%s\n' "$HOME/.local/bin" >> "${GITHUB_PATH:?}"
compact --version
compact update 0.31.1
compact compile +0.31.1 --version
node --version
npm --version
