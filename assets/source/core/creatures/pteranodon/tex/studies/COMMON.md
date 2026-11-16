# The pteranodon's material studies: what every study shares

You are painting one material study for the second real creature of a survival game that runs in the browser: a
pteranodon, the game's first flyer. The game is modelled on ARK: Survival Evolved for how things behave, and its art is
its own. The first creature, a dodo, set the bar; this animal is seen more, from further and from below, and carries a
rider, so its surfaces must hold up from the saddle at half a metre and read against the sky from a hundred.

Work only in your study's own folder, `tex/studies/<study>/`, inside the pteranodon's folder (the current folder).
Other studies are being painted at the same time in sibling folders; read them if you like, never write there. Take as
long as the job needs.

## The animal

Read `ref/DESIGN.md` first: it is the design every maker builds to. The pictures in `ref/` are ours, painted for this
animal, and you may look at them and give them to the image tool:

- `ref/concept.png`: the design on one page.
- `ref/concept/head_side.png`, `head_front.png`: the head close up (both about 1,000 pixels a metre).
- `ref/concept/three_quarter.png`, `underside.png`, `top.png`, `side.png`, `front.png`: the animal spread (the
  orthographic views are 400 pixels a metre); `folded_side.png`, `folded_front.png`: on the ground.
- `ref/concept/saddle_detail.png`, `saddled_*.png`: the saddle and its rider.
- `ref/concept/variants.png`: six colourings; `ref/concept/regions_*.png`: where the six colour regions lie.

In short: a lean coastal flyer with a big head, 7 m across the wings: a slate membrane of bare, matte, thin skin with
fine branching veins on a small, deep-chested ivory body covered in a short, fine, velvety fuzz; a charcoal mantle on
the back, a charcoal line up the nape and a charcoal streak through the small dark amber eye; a needle beak, a cap over
the skull and one sabre crest, all of smooth orange horn with faint growth lines, a charcoal band across the crest
near its tip; thin legs with orange horn-skinned grasping feet and dark curved claws. The saddle is a fitted hide seat
with stitched edges, a bent-wood cantle faced with pale chitin, rope-wrapped grips, plaited reins and rope foot rests.

## What a study is for

The animal's own maps are painted later, onto the modeller's texture layout, once it exists. These studies come first.
Each one settles how one surface is drawn, at what scale, and how it takes dye, so that the animal can then be painted
from them with no surprises. A study is also a source: the elements you generate (a tuft of fuzz, a vein network, a
patch of horn, a run of rope) and the scripts that place them will be used again to paint the animal. Keep them
reusable: the generated originals at full size, each element with its own aligned layers, and a build script whose
scale and direction can be changed by a number.

## How the game colours the animal

Players dye creatures. The pteranodon has six colour regions, and each animal rolls its own colour for each.

| Region | Name | Region map colour | On this animal |
|---|---|---|---|
| 0 | Patterning | red (255, 0, 0) | charcoal mantle, nape line, eye streak, wingtips |
| 1 | Wing Base | green (0, 255, 0) | the warm ash wash on the membrane by the body |
| 2 | Face, Crest and Hands | blue (0, 0, 255) | orange horn of beak, cap and crest; the skin of the small fingers, feet and toes |
| 3 | Inner Crest | cyan (0, 255, 255) | the charcoal band across the crest |
| 4 | Wing Membrane | magenta (255, 0, 255) | slate membrane, both faces |
| 5 | Body | yellow (255, 255, 0) | ivory fuzz of head, neck, body and limbs |
| none | never dyed | black (0, 0, 0) | eyes, claws, inside of the mouth; the saddle |

- **Under every dyed region the base colour is a light, neutral grey, and the region's colour is multiplied over it.**
  All the drawing in a dyed area lives in value and fine detail: lighter fibre tips and darker gaps between them, a
  vein a little darker than the skin round it, a horn's grain and pores. No hue at all: red, green and blue within 2
  levels of one another in every dyed pixel.
- **Every dyed region has the same mean grey: sRGB 188, which is 0.50 in linear light, within 0.02.** The game divides
  the dye by the material's mean grey, so a region drawn darker or lighter on average than the others comes out darker
  or lighter than its colour, and the far-away animal, drawn in flat region colours, would no longer match the near one.
  Value can range well above and below the mean; only the mean is fixed. Where a brief asks for two faces of one region
  to differ (the membrane's), it says what each face's mean is, and the two average 0.50.
- **Undyed parts** (eye, claws, inside of the mouth, the whole saddle) are painted in their own natural colours.
- **The region map** is pure colours only: every pixel exactly one of the seven above, no antialiasing, no blends. Its
  edges follow the real outlines of what they mark (the edge of the charcoal mantle follows the tips of the fuzz that
  carries it, not a straight cut). Any regions may touch (the engine keeps a channel for each). Where the design wants a
  soft fade between two regions (the membrane's wash), the animal's maps do it with masks made by hand; a study needs
  only the pure map.
- **It must look right in every colour.** The design's animal is ivory, charcoal, slate and orange. A breeder's worst
  choice is a hot pink membrane and a lime body; others pick near-black and near-white. The drawing must read as fuzz,
  skin, horn and veins in all of them: no detail that only works in one colour, no hue that fights the dye.

## Where the drawing lives (learned on the dodo)

The dodo's first studies came back with a flat base colour and every bit of the drawing moved into the height, so they
relit as grey plaster or clay with marks carved in it, and went blank under soft light and at a distance. That is
wrong. Unlit does not mean empty:

- **The base colour carries the material's own value drawing.** What makes a generated original look like fuzz, skin or
  horn at fine scale (light fibre tips and darker roots, the dark floor of a crease, a horn's mottling and grain, a
  vein's line) is pigment and fine structure, and it stays in the base. Only the broad light of the original (a
  direction, a gradient, a shadow cast across the form) is taken out. A base dyed and shown unlit should already look
  like the material, as a good game albedo does.
- **The height is the material's real relief at its real softness.** Fuzz has almost no hard edge: many fine fibres
  over a gentle rounding, with soft partings and tufts. Thin skin has fine creases and the slight rise of a vein. Horn
  is nearly smooth. Relit, it should look like the thing, not like the thing carved in plaster.
- **Bring the originals through.** If what you generated is beautiful, the delivered layers must be at least as
  beautiful. Before you stop, set your delivered base, and your delivered set relit, beside the generated original at
  the same scale: if the original has something yours lost, you are not done.
- **Real size.** Every feature has a size in millimetres on the animal, given in your brief or measurable from the
  concept at its stated scale. The dodo's studies were sent back for features twice their real size, regular as a
  grid, and copies of one element side by side. Vary everything natural: size, angle, spacing, value.

## The layers

Every set is these pictures, pixel-aligned (the same tuft in the same place in every layer):

1. `<set>_base.png`: base colour, sRGB, 8-bit. Flat and unlit: no light direction, no highlight, no cast shadow, no
   shading from the form, no darkening in crevices beyond the material's own pigment (the occlusion layer owns that).
   Where a set is cut out, RGBA with the alpha the cut-out (the game cuts at 0.5), and the colour carried on past the
   edge into the transparent area so filtering never draws a dark fringe.
2. `<set>_height.png`: 16-bit greyscale, white high, at the physical scale the set covers. Say in `study.json` how many
   millimetres the full range stands for.
3. `<set>_normal.png`: tangent-space normal map, OpenGL convention (green points to the top of the picture), computed
   from the delivered height at its physical scale, so the two agree. Tiles wrap when computing it.
4. `<set>_packed.png`: linear 8-bit RGB. Red occlusion (from the height; restrained, no light direction), green
   roughness, blue metalness (0 everywhere). Roughness tells the materials apart: dry velvet fuzz, matte skin, satin
   horn, polished claw, wet eye; on the saddle oiled hide, dry fibre, worn wood, waxy chitin.
5. `<set>_regions.png`: the region map, as above. Undyed sets (the eye, the claw, the saddle's) still deliver one, all
   black.

All square, 2,048 pixels unless your brief says otherwise. Keep the image tool's originals untouched in `source/`,
with the prompts you gave it, and every script that builds the layers (`build.py`) and checks them (`check.py`) in your
folder, so the whole study can be rebuilt by running them. Put your own check pictures in `checks/` (it is not kept).

Write `study.json` with a key `"sets"`: for each set by name, `span_m` (the metres one picture spans), `tiles`,
`cutout`, `height_mm`, `regions` (the regions it uses), `form` (below), and for a sheet of elements the box, root and
tip of each element in pixels. Anything else you want to record goes beside those keys.

## Scale and direction

The animal's maps give each surface a planned density (texels a metre on the animal). Studies are drawn at about twice
that, so they hold up close and shrink cleanly to the animal. Your brief gives each set's span. On the animal:

| Surface | Texels a metre on the animal |
|---|---|
| Fuzz of body, neck and limbs | about 1,400 |
| Fuzz of the face and head, horn of beak, cap and crest | about 2,400 |
| Feet, toes, small fingers | about 2,400 |
| Membrane, both faces | about 1,000 |
| Saddle: hide, rope, wood, chitin | about 900 |

A part smaller than its tile (an eye, a claw) is drawn as one panel covering the part with a margin. Unless your brief
says otherwise, the top of the picture is toward the root, the head or the body: fuzz lies from the top of the picture
toward the bottom, and a direction field on the animal will later turn the picture to lie the way the fuzz does.

## How it will be seen, and how to look at it

A rider sits on its shoulders: the neck, the head, the arms and the inner wing are half a metre to two metres from the
camera for as long as the animal is ridden. Others see it at 20 to 150 m, where the span is 270 to 36 pixels, very often
from below against a bright sky. Look at your study at full size, where fuzz must have fibres and horn its pores, and
shrunk to the animal's density and to a tenth of it, where the drawing must still read or fall away gracefully into an
even tone.

**The game's own renderer is the judge.** From the pteranodon's folder,

    bun tex/studies/look.ts tex/studies/<study>

draws each set in `study.json` on a form like the part it covers, with the game's own shader and lights, at 0.5 m in two
lights, at 1.5 m and at 5 m from the game's camera on a 1,080-row screen, in the design's dyes and in loud, dark and
pale ones (undyed sets once), into `tex/studies/<study>/checks/look/<set>.png`. It reads the layers as the game will
(the rgba variant, which holds a 2,048 study at 1,024: the animal's own density). Forms, as `study.json` gives them:

- `{"form": "ball", "radii": [x, y, z]}`: an egg, half-lengths in metres. For fuzz and the saddle's pad.
- `{"form": "tube", "radius": r, "flat": f, "taper": t, "length": l, "turn": false}`: a tube along its length,
  flattened to `f` of its width, its far end `t` of its near one. The picture's rows run round it; `"turn": true` runs
  them along it. For limbs, beak and crest, rope, wood, straps.
- `{"form": "sheet", "width": w, "depth": d, "camber": c, "face": "upper"}`: a cambered sheet, its upper face seen from
  above, or `"under"` seen from below against a bright sky. For the membrane.
- `{"form": "none"}`: a panel or a sheet of elements, not drawn there.

Also make your own Python previews: relit from two or three directions with the normal and occlusion, dyed in the
design's colour, in a loud one, near-black and near-white, at full size and shrunk, and beside the concept's own
picture of the part at the concept's scale.

## Measured

These are measured by the art director on what you deliver, the same way the game's own check does. Measure them
yourself first.

- Sizes: square, 2,048 unless your brief says otherwise, none under 64.
- Base colour: no light (the four quarters' means within 2%, and no correlation between the base and the light its own
  normal map would catch from any direction); neutral in dyed regions; each dyed region's mean grey 0.50 in linear
  light, within 0.02 (or the means your brief gives).
- Normal against height: the game's correlation, 0.9 or better across and down, unit length.
- Region map: every pixel one of the seven colours.
- Tiles: seamless both ways (the jump across the wrap edge no more than about 1.3 times the jump between neighbouring
  pixels inside, and nothing a half-offset shows), and no repeat a viewer finds when the tile is laid 3 by 3.
- Cut-outs: at the animal's density and at a quarter of it, the edge at the 0.5 cut is a fringe, not a blur.

## Rules

- Do not use or imitate pictures from any existing game, and do not search for or download reference images. Work from
  the design, our pictures and your own knowledge of real animals, skin, horn, leather, fibre and wood.
- Write nothing outside your study's folder.
- Python with Pillow, NumPy and SciPy is installed (run it as `python3`; the packages are in the user's site folder).
  Keep memory modest: float32, one 2,048 set in memory at a time. Do not run Blender: other makers on this machine need
  it.

## Report

Finish by writing `REPORT.md` in your folder: for each picture, how it was made (generated, edited, or computed by
script); the scale, the height range, and the mean grey of each region; which checks you ran and what you saw in the
game's renderer; how long it took; and plainly, where it still falls short.
