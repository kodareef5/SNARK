# Study: the plush cap and the lank mane

Read `tex/studies/COMMON.md` first and follow it. Your folder is `tex/studies/hood/`.

## What it shows

The hood is region 4 (magenta), umber by default. In the design's words: a plush cap of short, dense, soft feathers lying close over the crown and the back of the skull, small and irregular, so the skull's shape shows through. It comes down to a blunt point on the forehead between the brows and ends around the face in a ragged edge of small tufts. Behind, it lengthens into a lank mane of longer loose feathers lying down the back of the neck to about its middle. See `ref/concept/head_side.png`, `head_front.png`, `back.png` and `top.png`; `ref/concept/BRIEF_4.md` is how the cap was asked for in the concept.

- **The cap.** Small, soft, slightly fuzzy contour feathers, each just discernible: about 8 to 12 mm long on the forehead and crown, growing to 15 to 20 mm toward the back of the head. They overlap loosely and irregularly and vary a little in size and direction. Soft tips. Matte. No regular rows, no scales, no knit, no smooth fur: it is plush because the feathers are small, many and soft.
- **The mane.** Longer loose feathers, 4 to 7 cm, each with a vane and a soft tip, lying down the back of the neck, a little separated at their tips so the back of the neck is lank and a little shaggy. It grows out of the cap with no line between: the feathers simply lengthen.
- **The edge.** Around the face the cap ends unevenly in small tufts and wisps that overlap the bare skin, more ragged below and behind the eye. Those are feather cards on the bird, so they are elements here.

## Sets

1. `cap`: the plush cap. 2,048 pixels for 0.284 m, tiling both ways, feathers pointing down the picture (the bird's painter turns them to lie back over the skull).
2. `mane`: the lank mane. Same scale, tiling both ways, feathers hanging down the picture.
3. `cap_to_mane`: one picture, same scale, not tiling, the cap at the top lengthening into the mane at the bottom with no line between. It may tile across.
4. `hood_cards`: a sheet of cut-out elements (RGBA): about 10 small edge tufts of two to five cap feathers each, for the ragged edge and the forehead point, and about 8 single long mane feathers. 2,048 pixels for 0.341 m. Give each element's box, root and tip in `study.json`.

Keep each generated feather's own layers (cut-out, height, shaft) in `source/` so the bird's painter can place them again at any size along any direction.

## What excellent looks like

A close, plush cap of small dark feathers that is clearly part of a bird: dense and soft up close, with each feather just there; even and velvety shrunk to the bird, where it must still read as a dark cap across a field. The mane is the same feathers grown long and lank. Dyed near-white it is a white bird's cap, not a grey wig; dyed the default umber it is the hood of the concept views.
