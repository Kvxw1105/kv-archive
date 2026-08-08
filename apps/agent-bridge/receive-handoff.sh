#!/usr/bin/env sh
set -eu
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ "$#" -lt 2 ]; then echo "Usage: $0 Receiver-Handoff.zip OUTPUT_DIRECTORY [RECEIVER_NAME]" >&2; exit 2; fi
RECEIVER=${3:-receiving-agent}
exec node "$DIR/dist/agent/index.js" handoff-receive --handoff "$1" --output "$2" --receiver "$RECEIVER"
