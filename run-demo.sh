#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
node dist/apps/cli/src/index.js normalize fixtures/synthetic/multi-branch-conversation.json --output .tmp/output
printf '\nOutput written to %s/.tmp/output\n' "$PWD"
