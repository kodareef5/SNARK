# Study: the bare face, the brow and the throat pouch

Read `tex/studies/COMMON.md` first and follow it. Your folder is `tex/studies/face/`.

## What it shows

Three bare-skin surfaces of the head. See `ref/concept/head_side.png` and `head_front.png` above all.

- **The face** (region 1, green; rose buff by default). Bare, pebbled skin: a fine field of small rounded pebbles, 1 to 2 mm across, packed close, a little larger and flatter on the cheek and finer toward the eye and the beak, with the fine creases between them. A few soft folds cross it: under the eye, a set of soft concentric folds following its curve, and at the corner of the mouth a deeper fold that turns down. The skin is supple and slightly waxy, not leathery, not wet.
- **The brow** (region 3, cyan; ochre by default). A heavy, smooth shelf over each eye. Smooth means its relief is low and fine: a tight, shallow leathery grain, much finer and flatter than the face's pebbles, with a slight satin sheen.
- **The throat pouch** (region 3). Bare skin lying flat down the front of the neck, crossed by fine parallel pleats about 2 to 2.5 mm apart, like a folded fan laid flat: each pleat a soft rounded ridge with a fine crease between, the pleats running across the throat, some slightly uneven, a few merging or forking. The skin between is finely grained.

## Sets

1. `skin`: the pebbled face skin without the folds. 2,048 pixels for 0.205 m, tiling both ways.
2. `folds`: a sheet of fold elements that the bird's painter will lay onto the face along its geometry: an under-eye set of three or four soft concentric folds, a down-turned mouth-corner fold, and two or three single soft creases of different lengths. Each element is height, base and normal on the pebbled skin, faded to the plain skin at its edges so it can be laid over `skin` without a seam (its alpha says how much of it to lay). 2,048 pixels for 0.205 m. Give each element's box in `study.json`.
3. `brow`: the brow's skin. 2,048 pixels for 0.256 m, tiling both ways.
4. `pouch`: the pleated pouch. 2,048 pixels for 0.256 m, tiling both ways, the pleats running across the picture.

## What excellent looks like

Up close, the face is skin you believe: pebbles with their own little rims and the creases between them, folds that are soft and fleshy, not drawn lines. The brow is clearly smoother and firmer than the face beside it. The pouch's pleats are crisp and even enough to read as pleats at the bird's size and irregular enough to be skin up close. Shrunk to the bird they are the surfaces of the concept's head close-ups. All three take any colour: the face dyed pale ivory or dusky taupe, the brow and pouch in ochre, slate or dull orange, and still read as skin.
