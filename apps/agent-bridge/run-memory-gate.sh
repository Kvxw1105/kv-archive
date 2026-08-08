#!/usr/bin/env sh
set -eu
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ "$#" -lt 3 ]; then echo "Usage: $0 /path/to/Bundle.zip PROJECT OUTPUT_DIRECTORY [POLICY] [TOKEN_BUDGET]" >&2; exit 2; fi
POLICY=${4:-balanced}
TOKEN_BUDGET=${5:-2048}
exec node "$DIR/dist/agent/index.js" memory-gate --bundle "$1" --project "$2" --output "$3" --policy "$POLICY" --token-budget "$TOKEN_BUDGET"
