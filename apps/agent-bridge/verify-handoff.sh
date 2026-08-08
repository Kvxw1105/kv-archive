#!/usr/bin/env sh
set -eu
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ "$#" -lt 5 ]; then echo "Usage: $0 Receiver-Handoff.zip Private-Verification-Kit.zip Receiver-Receipt.json Response.json OUTPUT_DIRECTORY" >&2; exit 2; fi
exec node "$DIR/dist/agent/index.js" handoff-verify --handoff "$1" --verification-kit "$2" --receiver-receipt "$3" --response "$4" --output "$5"
