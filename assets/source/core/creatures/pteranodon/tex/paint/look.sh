#!/bin/zsh
# Builds the pteranodon with every painter's current layers, outside the repository, and draws it with the game's
# renderer.
#   zsh tex/paint/look.sh OUT_DIR          compose, build (Blender, about a minute) and draw
#   zsh tex/paint/look.sh OUT_DIR --maps   compose and draw on the model built last time, no Blender
# The tree is /private/tmp/ptera-look/tree, never under the repository's asset folders, where the game would take it
# for a second pteranodon. Pictures land in OUT_DIR.
set -e
HERE=${0:A:h}
ASSET=${HERE:h:h}
ROOT=${ASSET:h:h:h:h:h}
TREE=/private/tmp/ptera-look/tree
DIR=$TREE/core/creatures/pteranodon
OUT=${1:?OUT_DIR}
mkdir -p $DIR/tex $OUT
python3 $HERE/compose.py --out $DIR/tex
if [[ $2 != --maps || ! -f $DIR/pteranodon.snpk ]]; then
  cp $ASSET/rig.py $ASSET/model.py $ASSET/layout.json $DIR/
  sed "s|\.\./\.\./\.\./\.\./\.\./\.\./\.\./|$ROOT/|g" $HERE/look_asset.ts > $DIR/asset.ts
  (cd $ROOT && bun run art -- core:pteranodon --source $TREE --out $OUT/art)
fi
cd $ROOT
bun $HERE/look.ts --source $TREE --out $OUT
