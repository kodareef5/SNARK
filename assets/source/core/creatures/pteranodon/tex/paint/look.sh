#!/bin/zsh
# Builds the pteranodon with every painter's current layers, outside the repository, and draws it with the game's
# renderer.
#   zsh tex/paint/look.sh OUT_DIR          compose, build (Blender, about a minute) and draw
#   zsh tex/paint/look.sh OUT_DIR --maps   compose and draw on the model built last time, no Blender
# The build lives in /private/tmp/ptera-look/tree, never under the repository's asset folders, where the game would
# take it for a second pteranodon. With --maps each run composes into its own copy of it, named after OUT_DIR, so
# several painters can look at once. Pictures land in OUT_DIR.
set -e
HERE=${0:A:h}
ASSET=${HERE:h:h}
ROOT=${ASSET:h:h:h:h:h}
BUILT=/private/tmp/ptera-look/tree
OUT=${1:?OUT_DIR}
OUT=${OUT:A}
mkdir -p $OUT
if [[ $2 == --maps && -f $BUILT/core/creatures/pteranodon/pteranodon.snpk ]]; then
  TREE=/private/tmp/ptera-look/${${OUT//\//_}:1}
  rm -rf $TREE
  mkdir -p $TREE/core/creatures
  cp -R $BUILT/core/creatures/pteranodon $TREE/core/creatures/
else
  TREE=$BUILT
fi
DIR=$TREE/core/creatures/pteranodon
mkdir -p $DIR/tex
python3 $HERE/compose.py --out $DIR/tex
if [[ $TREE == $BUILT ]]; then
  cp $ASSET/rig.py $ASSET/model.py $ASSET/layout.json $DIR/
  sed "s|\.\./\.\./\.\./\.\./\.\./\.\./\.\./|$ROOT/|g" $HERE/look_asset.ts > $DIR/asset.ts
  (cd $ROOT && bun run art -- core:pteranodon --source $TREE --out $OUT/art)
fi
cd $ROOT
bun $HERE/look.ts --source $TREE --out $OUT
