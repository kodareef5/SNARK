# The dodo's material studies: what every study shares

You are painting one material study for the first real creature of a survival game that runs in the browser: a dodo. The game is modelled on ARK: Survival Evolved for how things behave, and its art is its own. This bird is the template every later creature follows, so the bar is high on purpose.

Work only in your study's own folder, `tex/studies/<study>/`, inside the dodo's folder (the current folder). Other studies are being painted at the same time in sibling folders; read them if you like, never write there. Take as long as the job needs.

## The bird

Read `ref/DESIGN.md` first: it is the design every maker builds to. The pictures are ours, painted for this bird, and you may look at them and give them to the image tool:

- `ref/concept/side.png`, `front.png`, `back.png`, `top.png`: the four views, 1500 pixels a metre.
- `ref/concept/three_quarter.png`: the character.
- `ref/concept/head_side.png`, `head_front.png`: the head close up.
- `ref/concept/variants.png`: six colourings.
- `ref/regions/side.png` and its siblings: where the six colour regions lie.

In short: a fat slate-grey ground bird 0.65 m tall, round as a sack, on short ochre legs; a huge olive horn beak with a worn hook; bare pebbled rose face; a heavy smooth ochre brow over a small, half-lidded straw eye; a plush umber cap of small feathers that ends in a lank mane down the nape; a flat pleated ochre pouch down the throat; soft rounded feathers in loose rows, with five narrow cream bars across back and rump; four cream feather fingers on each stubby wing; a curled tuft of seven tail feathers, each with two cream bands.

## What a study is for

The bird's own maps are painted later, onto the modeller's texture layout, once it exists. These studies come first. Each one settles how one surface is drawn, at what scale, and how it takes dye, so that the bird can then be painted from them with no surprises. A study is also a source: the elements you generate (a feather, a scale, a pebble field) and the scripts that place them will be used again to paint the bird. Keep them reusable: the generated originals at full size, each element with its own aligned layers, and a build script whose scale and direction can be changed by a number.

## How the game colours the bird

Players dye creatures. The bird has six colour regions, and each instance rolls its own colour for each.

| Region | Name | Region map colour |
|---|---|---|
| 0 | Body | red (255, 0, 0) |
| 1 | Face | green (0, 255, 0) |
| 2 | Beak | blue (0, 0, 255) |
| 3 | Forehead, Neck and Feet | cyan (0, 255, 255) |
| 4 | Head | magenta (255, 0, 255) |
| 5 | Wings and Patterning | yellow (255, 255, 0) |
| none | never dyed: eye, claws, inside of the mouth | black (0, 0, 0) |

- **Under every dyed region the base colour is a light, neutral grey, and the region's colour is multiplied over it.** All the drawing in a dyed area lives in value and fine detail: lighter shafts, darker gaps between barbs, a paler worn hook, darker grooves. No hue at all: red, green and blue within 2 levels of one another in every dyed pixel.
- **Every dyed region has the same mean grey: sRGB 188, which is 0.50 in linear light, within 0.02.** The game divides the dye by the material's mean grey, so a region drawn darker or lighter on average than the others comes out darker or lighter than its colour, and the far-away bird, drawn in flat region colours, would no longer match the near one. Value can range well above and below the mean; only the mean is fixed.
- **Undyed parts** (eye, claws, inside of the mouth) are painted in their own natural colours.
- **The region map** is pure colours only: every pixel exactly one of the seven above, no antialiasing, no blends. Its edges follow the real outlines of what they mark (the edge of a feather's pale tip follows that feather's ragged tip, not a straight cut).
- **The ring rule.** The game filters region maps as colours, and filtering is right only between neighbours on the ring red, yellow, green, cyan, blue, magenta (and back to red). Wherever two regions that are not neighbours on that ring touch (face and hood, face and beak, body and the scaly legs or throat pouch, brow and hood), put black between them, at least 4 pixels wide at 2,048. That black is undyed, so the base colour shows there as it is: draw it as what the gap naturally is, the dark crease where a tuft meets skin or the shadowed gap where feathers lie over scales, not as a pale line.
- **It must look right in every colour.** The default bird is slate body, rose face, olive beak, ochre brow, pouch and legs, umber cap, cream bars and fingers. A breeder's worst choice is a hot pink body and a lime beak; others will pick near-black and near-white. The drawing must read as feathers, horn, skin and scales in all of them: no detail that only works in one colour, no hue that fights the dye.

## Where the drawing lives (learned in round 1)

The first studies came back with a perfectly flat base colour and every bit of the drawing moved into the height, so they relit as grey plaster or clay with marks carved in it, and went blank under soft light and at a distance. That is wrong. Unlit does not mean empty:

- **The base colour carries the material's own value drawing.** What makes a generated original look like feathers, skin or horn at fine scale (light barbs and darker gaps between them, a paler shaft, the pale tops of pebbles and the darker floors of creases, a horn's grain) is pigment and fine structure, and it stays in the base. Only the broad light of the original (a direction, a gradient, a shadow cast across the form) is taken out. A base dyed and shown unlit should already look like the material, as a good game albedo does.
- **The height is the material's real relief at its real softness.** A feather or a lock of down has almost no hard edge: its relief is many fine barbs over a gentle rounding, with soft steps where one feather lies over the next. Skin folds are fleshy rolls. Relit, it should look like the thing, not like the thing carved in plaster.
- **Bring the originals through.** If what you generated is beautiful, the delivered layers must be at least as beautiful. Before you stop, set your delivered base, and your delivered set relit, beside the generated original at the same scale: if the original has something yours lost, you are not done.

## The layers

Every set is these pictures, pixel-aligned (the same feather in the same place in every layer):

1. `<set>_base.png`: base colour, sRGB, 8-bit. Flat and unlit: no light direction, no highlight, no cast shadow, no shading from the form, no darkening in crevices beyond the material's own pigment (the occlusion layer owns that). Where a set is cut out (feather cards), RGBA with the alpha the cut-out (the game cuts at 0.5), and the colour carried on past the edge into the transparent area so filtering never draws a dark fringe.
2. `<set>_height.png`: 16-bit greyscale, white high, at the physical scale the set covers. Say in `study.json` how many millimetres the full range stands for.
3. `<set>_normal.png`: tangent-space normal map, OpenGL convention (green points to the top of the picture), computed from the delivered height at its physical scale, so the two agree. Tiles wrap when computing it.
4. `<set>_packed.png`: linear 8-bit RGB. Red occlusion (from the height; restrained, no light direction), green roughness, blue metalness (0 everywhere). Roughness tells the materials apart: dry matte feathers, waxy skin, satin horn, polished claw, wet eye.
5. `<set>_regions.png`: the region map, as above. Undyed sets (the eye, the claw) still deliver one, all black.

All square, 2,048 pixels unless your brief says otherwise. Keep the image tool's originals untouched in `source/`, with the prompts you gave it, and every script that builds the layers (`build.py`) and checks them (`check.py`) in your folder, so the whole study can be rebuilt by running them. Put your own check pictures in `checks/` (it is not kept). Write `study.json`: for each set, the metres one picture spans (`span_m`), whether it tiles (`tiles`), whether it is cut out (`cutout`), the height range in millimetres (`height_mm`), which regions it uses, and for a sheet of elements the box, root and tip of each element in pixels.

## Scale and direction

The bird's maps give each surface a planned density (texels a metre on the bird). Studies are drawn at twice that, so they hold up close and shrink cleanly to the bird:

| Surface | On the bird | In the study |
|---|---|---|
| Body, neck, wing coverts, trousers | 2,400 | 4,800 (2,048 pixels = 0.427 m) |
| Hood: cap and mane | 3,600 | 7,200 (2,048 = 0.284 m) |
| Face skin, lid, eye | 5,000 | 10,000 (2,048 = 0.205 m) |
| Brow, throat pouch, beak | 4,000 | 8,000 (2,048 = 0.256 m) |
| Legs, toes, claws | 3,000 | 6,000 (2,048 = 0.341 m) |
| Feather cards (their own 512 texture on the bird) | about 1,500 | 6,000 (2,048 = 0.341 m) |

A part smaller than its tile (the eye, a lid, a toe, a claw) is drawn as one panel covering the part with a margin, at no less than the study density. Unless your brief says otherwise, the top of the picture is toward the root: feathers grow from the top of the picture and point their tips down it, plates run across it, and a direction field on the bird will later turn the picture to lie the way the feathers do.

## How it will be seen

A player carries this bird in both arms and looks at it from arm's length; most of the time it is 20 to 200 pixels tall on screen. Look at your study both ways: at full size, where a feather must have a shaft and barbs and a scale must have a rim, and shrunk to the bird's size and to the size it covers when the bird is 200 and 50 pixels tall, where the rows, the bars, the plates and the grooves must still read or fall away gracefully into an even tone. `ref/concept/read_sizes.png` shows those sizes. Relight it from two or three directions using the normal and occlusion, and look at it dyed in the default colour, in hot pink or lime, in near-black and in near-white.

## What excellent looks like

The example to beat is the feather material in the repository's `planning/artist-test/feather/` (from this folder, `../../../../../planning/artist-test/feather/`): start with `qa/layers_contact.png` and `qa/relighting_preview.png`, then `REPORT.md`, `build_material.py` and `check_material.py`. It is a complete, aligned, tileable set made from a generated source, with its own build and check scripts. It falls short in ways you should not: its pale tips were cut with straight edges that do not follow the feathers; all 42 feathers came from one generated feather, so a family resemblance shows; its relief is so slight that relit it reads as a print; its base colour carries a brown hue; and it was only ever looked at as a flat tile.

Beat it. A stranger looking at your study at full size should believe it is a photograph of the real thing, cleaned of its light. Shrunk to the bird, it should look like the concept views. Painted on the bird, it should take any colour a player gives it.

## Measured

These are measured by the art director on what you deliver, the same way the game's own check does. Measure them yourself first.

- Sizes: square, 2,048 unless your brief says otherwise, none under 64.
- Base colour: no light (the four quarters' means within 2%, and no correlation between the base and the light its own normal map would catch from any direction); neutral in dyed regions; each dyed region's mean grey 0.50 in linear light, within 0.02.
- Normal against height: the game's correlation, 0.9 or better across and down, unit length.
- Region map: every pixel one of the seven colours; no two regions that are not neighbours on the ring touching.
- Tiles: seamless both ways (the jump across the wrap edge no more than about 1.3 times the jump between neighbouring pixels inside, and nothing a half-offset shows).
- Cut-outs: at the bird's size and at a quarter of it, the edge at the 0.5 cut is a fringe of feather tips, not a blur or a smooth curve.

## Rules

- Do not use or imitate pictures from any existing game, and do not search for or download reference images. Work from the design, our pictures and your own knowledge of real birds.
- Write nothing outside your study's folder.
- Python with Pillow, NumPy and SciPy is installed. Do not run Blender: other makers on this machine need it, one at a time. Python previews are enough.

## Report

Finish by writing `REPORT.md` in your folder: for each picture, how it was made (generated, edited, or computed by script); the scale, the height range, and the mean grey of each region; which checks you ran and what you saw; how long it took; and plainly, where it still falls short.
