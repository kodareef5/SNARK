#!/usr/bin/env bash
# Builds the pteranodon with every painter's current layers, outside the repository, and draws it with the game's
# renderer.
#   bash tex/paint/look.sh OUT_DIR          compose, build (Blender, about a minute) and draw
#   bash tex/paint/look.sh OUT_DIR --maps   compose and draw on the model built last time, no Blender
#   bash tex/paint/look.sh OUT_DIR --maps --stages   the same, and every hurt and decay stage (tex/*_hurt.png, _decay.png)
# The build lives in /tmp/ptera-look/tree, never under the repository's asset folders, where the game would
# take it for a second pteranodon. With --maps each run composes into its own copy of it, named after OUT_DIR, so
# several painters can look at once. Pictures land in OUT_DIR. /tmp, not the Mac's /private/tmp, which is the same
# folder there and no folder on Linux; bash down to the Mac's 3.2, not zsh.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
ASSET=$(cd "$HERE/../.." && pwd)
ROOT=$(cd "$ASSET/../../../../.." && pwd)
BUILT=/tmp/ptera-look/tree
OUT=${1:?OUT_DIR}
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)
if [[ ${2:-} == --maps && -f $BUILT/core/creatures/pteranodon/pteranodon.snpk ]]; then
  slug=${OUT//\//_}
  TREE=/tmp/ptera-look/${slug:1}
  rm -rf "$TREE"
  mkdir -p "$TREE/core/creatures"
  cp -R "$BUILT/core/creatures/pteranodon" "$TREE/core/creatures/"
else
  TREE=$BUILT
fi
DIR=$TREE/core/creatures/pteranodon
mkdir -p "$DIR/tex"
python3 "$HERE/compose.py" --out "$DIR/tex"
# A stage no painter has drawn yet is no file, and its pattern then stands for nothing.
shopt -s nullglob
rm -f "$DIR"/tex/*_hurt.png "$DIR"/tex/*_decay.png
for f in "$ASSET"/tex/pteranodon*_hurt.png "$ASSET"/tex/pteranodon*_decay.png; do cp "$f" "$DIR/tex/"; done
shopt -u nullglob
sed "s|\.\./\.\./\.\./\.\./\.\./\.\./\.\./|$ROOT/|g" "$HERE/look_asset.ts" > "$DIR/asset.ts"
if [[ $TREE == "$BUILT" ]]; then
  cp "$ASSET/rig.py" "$ASSET/model.py" "$ASSET/layout.json" "$ASSET/saddle.py" "$ASSET/saddle_layout.json" "$DIR/"
  (cd "$ROOT" && bun run art -- core:pteranodon --source "$TREE" --out "$OUT/art")
fi
cd "$ROOT"
bun "$HERE/look.ts" --source "$TREE" --out "$OUT" "${@:3}"
