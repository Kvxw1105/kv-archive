#!/usr/bin/env sh
set -eu
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ "$#" -lt 1 ]; then echo "Usage: $0 /path/to/KV-Archive-Agent-Bundle.zip [proposal-directory]" >&2; exit 2; fi
PROPOSAL_DIR=${2:-./kv-archive-proposals}
exec node "$DIR/dist/agent/index.js" serve --bundle "$1" --proposal-dir "$PROPOSAL_DIR"
