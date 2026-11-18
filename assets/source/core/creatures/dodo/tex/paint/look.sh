#!/usr/bin/env bash
# Puts every painter's current layers on the built bird and draws it close up with the game's renderer.
#   bash tex/paint/look.sh OUT_DIR
# The bird's pack is built by the art director with Blender into /tmp/dodo-look/tree, outside the repository's
# asset folders so that the game never takes it for a second dodo; this script only composes the maps into that tree
# and draws it. Pictures land in OUT_DIR. /tmp, not the Mac's /private/tmp, which is the same folder there and
# no folder on Linux; bash down to the Mac's 3.2, not zsh.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../../../../../../.." && pwd)
TREE=/tmp/dodo-look/tree
OUT=${1:?OUT_DIR}
[[ -f $TREE/core/creatures/dodo/dodo.snpk ]] || { echo "no built bird in $TREE: ask the art director"; exit 1; }
python3 -I "$HERE/compose.py" --out "$TREE/core/creatures/dodo/tex"
cd "$ROOT"
bun "$HERE/look.ts" --source "$TREE" --out "$OUT"
