# Painting the dodo: what every painter shares

Your material study is accepted. Now paint the bird itself: the pieces of the modeller's texture layout that belong to your group, from your study (its look, its generated originals, its elements and its scripts), to the bird's real form. Several painters work at once, one group of pieces each; `compose.py` puts your layers together with everyone else's into the bird's maps. `tex/studies/COMMON.md` still holds in full (the dye rules, where the drawing lives, unlit, real relief, no Blender); this adds what painting onto the bird needs.

Work only in `tex/paint/<your group>/`. Take as long as the job needs.

## What you paint on

- **The layout.** `ref/bakes/` (read `bakes.json` first). `dodo_layout.png` names the pieces of the opaque material `dodo` (2,048 square). It is the bird's left side; the right side is the same texels mirrored, so each piece is painted once. `dodo_regions.png` is each texel's colour region.
- **The pieces, exactly.** `tex/paint/pieces.png` (red channel = piece number) and `tex/paint/pieces.json` (number, name, region, box, texels, median millimetres a texel) say which texels are which piece. Your group's pieces are listed below and in `compose.py` (GROUPS); paint every texel of them and nothing else.
- **The bird's own space.** `tex/paint/position_x.png`, `position_y.png`, `position_z.png` give every texel's place on the bird at rest, 16 bits each over `position_box` in `pieces.json` (metres; x to the bird's left, y up, z forward). `ref/bakes/dodo_normal_object.png` is the surface's facing there. With these you can place anything where it belongs on the body (an eye fold under the eye, a bar across the back) and draw a feather that crosses a cut in the layout whole on both sides. `tex/paint/texel_mm.png` gives how many millimetres one texel spans (value / 1,000): it varies a great deal from piece to piece (0.18 mm on the face, 0.47 on the body), so size everything in millimetres on the bird, never in texels.
- **Which way feathers lie.** `ref/bakes/dodo_feather_direction.png`: red = 0.5 + 0.5 u, green = 0.5 + 0.5 v with v up the picture, where blue is 1.
- **Form.** `dodo_curvature.png` and `dodo_occlusion.png` say where the surface bulges, hollows and is sheltered. Use them to place things (dirt in a crease, a fold on a hollow), not to shade: `compose.py` multiplies the modeller's occlusion into the packed map itself.
- **Cards.** The cut-out material `dodo_cards` is 512 on the bird. Every card of a kind shares one rectangle (`bakes.json`, as u0, v0, u1, v1 with v up: at 2,048 the rectangle's rows run from (1 - v1) x 2,048 to (1 - v0) x 2,048). Strips (hood, body, trousers, mane, forehead) hang from the top of their rectangle, roots up and tips down, with u along their length; tail and finger feathers stand root down, tip up. A card's real size, from the model: tail 35 mm across by 124 long; finger 22 by 56; forehead tuft 23 by 12; mane 78 across by 70 down; hood strip 157 along by 12 down; body strip 309 by 16; trousers strip 288 by 48. A strip is stretched far more along than across, so draw in each rectangle's own proportions: a feather must look right once the card is that size on the bird.
- **The concept.** `ref/concept/` as before: the bird must look like these pictures.

## What you deliver

In `tex/paint/<group>/layers/` (left out of the repository; your script makes it again):

- `dodo_base.png`: RGBA 2,048, sRGB. Your pieces' base colour, alpha 255 on every texel of your pieces.
- `dodo_height.png`: 16-bit grey 2,048, height on your pieces, and `layers.json` with `height_mm`, the millimetres the full 0 to 65,535 range stands for. Real relief in real millimetres: `compose.py` makes the normal map from it at each texel's true size, so do not deliver a normal map.
- `dodo_rough.png` and `dodo_occlusion.png`: 8-bit grey 2,048, roughness and your material's own fine occlusion (pores, creases, barbs: not the form's).
- `dodo_regions.png`: the build's region colours on your texels. It equals `ref/bakes/dodo_regions.png` except where the design paints yellow on the body (the bars).
- For a group with cards: the same five as `cards_base.png` (RGBA, alpha the cut-out at 0.5), `cards_height.png` (with `cards_height_mm` in `layers.json`), `cards_rough.png`, `cards_occlusion.png`, `cards_regions.png`, all at 2,048, four times the cards' 512, filled only inside your rectangles. `compose.py` shrinks them.

Beside it, kept in the repository: `paint.py`, which writes `layers/` from your study's originals and elements and the files above, the same bytes every run. The modeller may refine the form and rebake, which moves the pieces' edges a little; `tex/paint/pieces.png` and its siblings are then made again, so `paint.py` reads them each time it runs and paints whatever texels they give it, never a fixed list; any new generated originals with their prompts in `source/`; and `REPORT.md`.

To see the whole bird as the game draws it, run `bash tex/paint/look.sh <a folder of yours>` from the dodo's folder: it puts every painter's current layers on the built bird and draws it from several sides and close up, in its default dyes and in loud ones. Look at your pieces there before you stop. The built bird lives in `/tmp/dodo-look/`, outside the repository: never copy a built pack (`.snpk`) or an `asset.ts` anywhere under the repository's folders (the game would take it for a second dodo), and keep your own scripts in Python, since every TypeScript file in the repository is type-checked with the game. You can also run `python3 -I tex/paint/compose.py --out <a folder of yours>` to see your pieces joined with the rest (groups not yet painted stay plain grey) and check them in your own Python previews: in the layout, dyed, relit, and through the position maps from the front, side and back. The art director builds the bird from the composed maps and looks at it in the game's own renderer.

## What excellent looks like

- **Painted to the form.** Feather rows follow the direction field and wrap the body's roundness; feathers are their real size everywhere; the bars lie across the back where the design puts them; wrinkles sit on the folds; plates run down the front of the leg; the grooves ring the beak at its base and the worn pale hook is at its tip.
- **No seam anyone can find.** Where a piece's edge meets another piece of yours, the drawing runs on across it. Where it meets the mirror line (x = 0, the bird's midline), whatever crosses it is symmetric there, since the right side is the left mirrored. Where your piece meets another group's piece, the regions change there; keep the value and relief calm along that edge so the two sides meet without a line of their own.
- **It takes dye** exactly as in the studies: neutral grey under every dyed region, each region's mean 0.50 in linear light on your texels, all drawing in value and relief; undyed parts (eye, claws, inside of the mouth, tongue) in their own colours. `compose.py` holds each region's mean at 0.50 in the end, but if yours is more than 5% off it says so, and your painting should not need it.
- **It reads small and holds up close**, as in the studies: rows, bars, hood, brow and beak at 20 to 200 pixels; shaft and barbs, pebbles, pits and plates from arm's length.

## Report

`REPORT.md` in your folder: what you painted where and how, the sizes on the bird, where it still falls short. Say if anything in the layout or the bakes stopped you doing it right.
