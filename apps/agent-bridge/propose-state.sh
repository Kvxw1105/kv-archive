#!/usr/bin/env sh
set -eu
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ "$#" -lt 2 ]; then echo "Usage: $0 /path/to/Bundle.zip /path/to/proposal-draft.json [proposal-directory]" >&2; exit 2; fi
PROPOSAL_DIR=${3:-./kv-archive-proposals}
exec node "$DIR/dist/agent/index.js" propose --bundle "$1" --input "$2" --proposal-dir "$PROPOSAL_DIR"
