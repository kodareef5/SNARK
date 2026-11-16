# Painting the pteranodon: what every painter shares

The material studies are done. Now paint the animal itself: the pieces of the modeller's texture layout that belong to
your group, from the studies (their look, their generated originals, their elements and their scripts), to the
animal's real form. Several painters work at once, one group of pieces each; `compose.py` puts your layers together
with everyone else's into the animal's maps. `tex/studies/COMMON.md` still holds in full (the dye rules, where the
drawing lives, unlit, real relief, real sizes, no Blender); this adds what painting onto the animal needs. Read
`ref/DESIGN.md` again first: it is the design.

Work only in `tex/paint/<your group>/`. Take as long as the job needs.

## What you paint on

- **The layouts.** `ref/bakes/bakes.json` first, then `ref/bakes/pteranodon_layout.png` and
  `pteranodon_wing_layout.png`, which name the pieces of the two materials, both 2,048 square:
  - `pteranodon`, the closed body: torso, neck, head (face, skull cap, back of the head, throat), beak, jaw (with the
    palate, the inside of the mouth), crest, eye, leg, the four toes, the three small fingers of the hand. It is the
    animal's left side; the right side is the same texels mirrored, so each piece is painted once, and whatever
    crosses the midline (x = 0: the back, the belly, the top of the head and beak) must be symmetric there.
  - `pteranodon_wing`, the left wing; the right is its mirror. Its top band is the membrane's upper face as the
    concept's `top.png` shows the left wing (tip to the left, leading edge up), its middle band the under face as
    `underside.png` shows it (tip to the right, leading edge up), both at about 600 texels a metre; below them the arm
    (shoulder to knuckle) and the wing finger (knuckle to tip), each a strip along its length, round the bone upward,
    cut along the back where the membrane goes in.
- **The pieces, exactly.** `tex/paint/<material>_pieces.png` (red channel = piece number) and `_pieces.json`
  (number, name, the regions the model gives it, box, texels, median millimetres a texel) say which texels are which
  piece. Your group's pieces are listed in your brief and in `compose.py` (GROUPS); paint every texel of them and
  nothing else.
- **The animal's own space.** `tex/paint/<material>_position_x.png`, `_y.png`, `_z.png` give every texel's place on
  the animal at rest, the glide, 16 bits each over `position_box` in `_pieces.json` (metres; x to the animal's left, y
  up, z forward). `ref/bakes/<material>_normal_object.png` is the surface's facing there. With these you place things
  where they belong (the mantle on the back, the streak through the eye, the wash by the flank, a vein running from
  the leading edge back) and draw what crosses a cut in the layout whole on both sides of it.
  `tex/paint/<material>_texel_mm.png` gives how many millimetres one texel spans (value / 1,000): about 0.5 on the head
  and feet, 0.8 to 0.95 on the neck, torso and leg, 1.4 on the arm and finger, 1.7 on the membrane. Size everything in
  millimetres on the animal, never in texels, and make anything that must read at least two texels wide.
- **Which way things run.** `ref/bakes/<material>_flow.png`: the way the fuzz lies, and on the membrane the way the
  veins run, as a direction in the picture: red = 0.5 + 0.5 u, green = 0.5 + 0.5 v with v up the picture, where blue
  is 1.
- **Form.** `ref/bakes/<material>_curvature.png` says where the surface bulges and hollows. Use it to place things,
  not to shade. The modeller's occlusion bakes (`<material>_occlusion.png`) follow; `compose.py` multiplies them into
  the packed map itself, so your occlusion is your material's own fine occlusion only.
- **Regions.** `ref/bakes/<material>_regions.png` is where the model puts the six regions, face by face: a guide only,
  stepped along the faces. Paint the real edges, as `ref/DESIGN.md` and the concept's `regions_*.png` place them.
- **The model may still be refined.** The layout will not move, but a piece's edges may shift a texel or two when the
  modeller rebakes, and `tex/paint/pieces.py` makes the maps above again. So your script reads them every time it
  runs and paints whatever texels they give it, never a fixed list.
- **The studies.** `tex/studies/<study>/` holds each accepted study: its `REPORT.md`, `study.json`, its originals and
  elements in `source/`, its `build.py`. Its delivered pictures are not in the repository; if they are missing, run
  that study's `build.py` (it writes them byte for byte), never edit anything there. The fuzz study is in its last
  round now: read its layers when your script runs, so that running it again takes the final fuzz.

## What you deliver

In `tex/paint/<group>/layers/` (left out of the repository; your script makes it again), for each material you paint:

- `<material>_base.png`: RGBA 2,048, sRGB. Your pieces' base colour, alpha 255 on every texel of your pieces.
- `<material>_height.png`: 16-bit grey 2,048, height on your pieces, and `layers.json` with `<material>_height_mm`,
  the millimetres the full 0 to 65,535 range stands for. Real relief in real millimetres: `compose.py` makes the normal
  map from it at each texel's true size, so do not deliver a normal map.
- `<material>_rough.png` and `<material>_occlusion.png`: 8-bit grey 2,048, roughness and your material's own fine
  occlusion (the gaps between locks, pores, creases: not the form's).
- On `pteranodon`, `<material>_regions.png`: the build's region colours on your texels, pure colours, black where never
  dyed. On `pteranodon_wing`, `<material>_mask.png` and `<material>_mask2.png` instead: how much of regions 0, 1, 2
  (red, green, blue of the first) and 3, 4, 5 (of the second) each texel has, 0 to 255, never summing past 255, so that
  the wash can fade.

Beside it, kept in the repository: `paint.py`, which writes `layers/` from the studies, your own sources and the maps
above, the same bytes every run; any new generated originals with their prompts in `source/`; and `REPORT.md`.

## Looking at it

`zsh tex/paint/look.sh <a folder of yours> --maps` (from the pteranodon's folder, about a minute) composes every
painter's current layers, puts them on the built animal outside the repository, and draws it with the game's own
renderer: from below against the sky at the four distances it is seen (`sizes_*.png`), from above, three quarters,
the side, the head close, from the rider's seat, the inner wing from above and below, the feet; in the design's dyes
and in loud and dark ones. Always pass `--maps`: it needs no Blender. The renderer reads the rgba variant, which holds
the maps at 1,024, half what high and ultra show. You can also run `python3 tex/paint/compose.py --out <a folder of
yours>` to see the composed maps and check them in your own Python previews. Judge in the game's renderer first.

## What excellent looks like

- **The concept, on the model.** Beside `ref/concept/three_quarter.png`, `top.png`, `underside.png`, `side.png`,
  `head_side.png`, `head_front.png` and `saddle_detail.png`, at the same pixels a metre, the painted animal is the same
  animal: the same placement of every colour region, the same character of fuzz, horn, skin and veins.
- **Painted to the form.** The fuzz lies along the flow and wraps the body's roundness; the mantle, the nape line and
  the eye streak sit where the design puts them with soft edges of interlocking fuzz; the horn's growth lines run along
  the beak and up the crest; the veins run from the leading edge back, swept toward the tip.
- **No seam anyone can find.** Where a piece's edge meets another of yours, the drawing runs on across it. At the
  midline whatever crosses is symmetric. Where your piece meets another group's, keep value and relief calm along that
  edge so the two sides meet without a line of their own.
- **It takes dye** exactly as in the studies: neutral grey under every dyed region, each region's mean 0.50 in linear
  light over the material (the membrane's upper face darker, about 0.40, its under face lighter, about 0.60), all
  drawing in value and relief; undyed parts in their own colours. `compose.py` holds each region's mean at 0.50 in the
  end, but if yours is more than 5% off it says so, and your painting should not need it.
- **It reads small and holds up close**, as in the studies: the M with its dark tips and pale body from below at 60 m;
  the fuzz, horn and veins from the saddle.

## Report

`REPORT.md` in your folder: what you painted where and how, the sizes on the animal, where it still falls short. Say if
anything in the layout or the bakes stopped you doing it right.
