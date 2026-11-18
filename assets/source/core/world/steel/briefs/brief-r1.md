# A world finish for a browser game: one tileable material set

You are painting one of sixteen "world finishes" for a survival game set in Miami decades after people left it: salt, sun and tropical rain have had the city to themselves. Work only in the current folder. You may write and run scripts (Python with Pillow, numpy and scipy are installed) and use the image generation tool as often as you like.

## What a finish is in the game

The ground (roads, lawns, beaches, lots) and every building without art of its own are drawn with one of sixteen finishes. A finish is a square material set that the game repeats across the world in metres: the tile covers a fixed number of metres on a side (given below), laid flat on the ground and straight on walls, floors and ceilings alike. The same tile is seen:

- at arm's length (2 m), where its fine relief catches a low sun and its roughness shows wet against dry;
- at 10 m along a street, where dozens of repeats are in view at once and the eye hunts for any feature that comes back;
- at 100 m from a roof and from the air, where the tile is a few pixels across and only its mean colour, roughness and value survive.

The game adds the large variation itself, across 10 to 50 m: stains, dry and wet patches, repairs, wear along roads, and the colour of each building and lot. So the tile must be the material at its most ordinary: even, homogeneous, rich in fine detail, with nothing in it that the eye can find again. A crack, a stain, a leaf, a flower, a shell, an odd stone, a darker corner: if you can find it in a 3 by 3 tiling, it is wrong. Variation inside the tile should be at a scale of a quarter of the tile or finer.

Each building and lot also gives its finish a colour from the game's palette. The game multiplies the base colour by that colour where your tint mask says the colour belongs (paint, plaster coat, the body of a brick, living grass blades), and leaves the material's own colour where it does not (bare aggregate, mortar, bare metal, rust scale, soil between grass). So the base colour's mean should sit close to the target given below, and on a tinted layer it should be close to neutral in hue so the palette's colour reads true.

## What to deliver

All maps 2048 by 2048, square, pixel-aligned with one another, tiling seamlessly in both directions:

1. `base.png`: base colour, sRGB, 8-bit RGB. Lit evenly from everywhere: no cast shadows, no shading from relief, no highlights, no sky reflection, no vignette or gradient. A cavity can be darker where dirt sits in it, never because it is shaded.
2. `height.png`: 16-bit greyscale, white high, the full range used. All of the finish's relief is in it, so that a normal map computed from it is the finish's true normal. The game also uses it where two finishes meet: the higher wins, so sand lies in the joints of paving and grass stands over soil. A dark stain is not a dent: height comes from shape, never from colour.
3. `normal.png`: tangent-space normal map computed from your height, OpenGL convention (red right, green toward the top of the image), 8-bit RGB. It is for checking; the game computes its own from your height, so they must agree.
4. `roughness.png`: 8-bit greyscale, linear, 0 mirror and 255 fully rough.
5. `occlusion.png`: 8-bit greyscale, linear: cavity and crevice occlusion from the relief, 255 open. It darkens cavities, never whole areas.
6. `tint.png`: 8-bit greyscale, linear: 255 where the building's or lot's colour belongs, 0 where the material keeps its own colour.
7. `metal.png`, only where the finish has bare metal: 8-bit greyscale, 255 bare metal, 0 not.
8. `material.json`: `{"metres": <tile width in metres>, "height_mm": <millimetres between black and white in height.png>, "module": [<u>, <v>] or null, "mean_srgb": [r, g, b]}`. `module` is for a laid pattern (bricks, pavers, boards, tiles): the smallest shift, as a fraction of the tile across and down, that maps the laying pattern onto itself, so the game can shift a copy by it and the joints still line up. Null for a natural finish.
9. `REPORT.md`: for each file, how it was made; what you checked and what you saw; what you are not satisfied with.
10. `checks/`: the pictures you judged by (below).

Real detail at 2048: the image tool gives about 1,254 pixels a side, so build the 2048 master from several generations or crops placed, quilted and blended, or from generated elements laid into a larger master. A plain upscale of one picture is soft and will be sent back.

## How it will be judged, and how you should judge it first

Make these and look at them yourself before you finish; fix what you see:

- `checks/offset.png`: the base colour shifted by half a tile both ways with wrap-around; the same for height and roughness. No seam, no change of density or tone across the old edges.
- `checks/tiled3.png`: a 3 by 3 tiling of the base colour at full size, and of the height. Nothing found twice.
- `checks/tiled12.png`: a 12 by 12 tiling shrunk to 2048 (the finish seen from 20 to 50 m). No grid, no diagonal bands, no blotches lining up.
- `checks/relit.png`: the finish lit from the height or normal with a low sun (15 degrees above the horizon) from two opposite sides and a high sun (70 degrees), base colour times light, so relief turns with the light and nothing looks painted on.
- `checks/layers.png`: all maps side by side at one crop, so they visibly line up.

Bad, and sent back: baked light or shadow in the base colour; a seam; a hero feature that repeats; soft detail from upscaling; height derived from colour; a normal map that disagrees with the height; occlusion that darkens broad areas; a mean colour far from the target; saturated, toy-like colour; detail so busy at 2048 that it sparkles when shrunk (look at your 12 by 12 sheet); a direction to the light anywhere.

## Outside references

Comparison photographs or scans from outside are fine to look at, but keep them out of the delivered maps and out of this folder's sources, and do not name their authors in the report.

## The game's look, for reference

`reference-street.png` (attached) is the game today, on its high tier, with the old finishes: the walls are concrete, the ground asphalt, sand and grass. Those old finishes are what this replaces. The light the game aims for is just after a coastal shower: hard sun, readable shade, muted stucco and grass, pale concrete throwing light back.

## This finish: steel

Structural and sheet steel: beams, railings, bridge members, doors and shutters, the frames of signs. Painted, the paint worn.

- Tile: 2 m across. Height range about 2 mm.
- What it is: painted steel after years in salt air: a matte industrial paint film over mill-scale steel, worn through to bare grey steel in small scattered scuffs and chips, fine pitting and tiny rust specks in the chips, faint orange-peel texture in the paint. No direction to it (used on beams running every way).
- At arm's length: bare chips flash in the sun against the matte paint. At 10 m: an even painted metal with faint sparkle. At 100 m: the paint's colour.
- Not in this tile: seams, bolts, welds, streaks, runs, dents, large rust areas.
- Paint in the base colour a near-neutral mid grey about sRGB (125, 124, 120) (the palette gives it its colour); bare steel a metal grey about (165, 165, 163).
- Base colour mean about sRGB (113, 111, 106).
- Roughness: paint 0.55 to 0.7, bare steel 0.3 to 0.45, rust specks 0.9.
- Metal: bare steel 255, paint and rust 0.
- Tint: paint 255, bare steel and rust 0.
- Module: null.
