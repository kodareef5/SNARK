# Masonry: the wall stone of a stronghold

You are making one tiling material for a survival building game, and you have the whole job: generation, every layer, your own build and check scripts, looking at the result and fixing it. Work only in this folder. Python 3 with Pillow, NumPy and SciPy is installed. Keep every source picture the image tool gives you in `source/`, and every prompt you used in `prompts.md`.

## What it is for

Players build bases out of stone walls by the hundred: this material is what the game looks like most of the time. It is the face of every stone wall, doorframe and windowframe. Stone is what a base becomes when its builders mean to keep it, so it must look heavy, and a wall of it must look laid by masons, stone by stone, not printed.

The wall is coursed squared rubble: rough-cut limestone blocks of different lengths, laid in courses in lime mortar. One tile is exactly one wall piece, 3 m by 3 m, and it repeats across a wall of many pieces and up a wall of several storeys, so it must tile in both directions with no visible seam.

## The pattern is fixed: paint to it

The stones are already decided, because the game models every stone as real geometry and your picture is laid over that geometry. `layout/cells.png` (2048 by 2048) shows each stone as a flat colour of its own with the joints as black lines; `layout/layout.json` gives every stone's four corners in metres and in pixels. A stone whose corners pass u = 3 m wraps round to the left edge. `layout/tiled.png` shows the pattern repeated.

- Every joint in your picture lies on a line of the layout, and every line of the layout is a joint in your picture. One stone of the layout is one stone in your picture: do not split a stone in two or merge two.
- The modelled joint is a vee: each stone's edge is cut back 25 mm across the face and 18 mm deep. So within about 25 mm of each line the stone's arris is broken, rounded or spalled, and at the line itself is mortar. Let the mortar show 6 to 20 mm either side of the line, irregular, as rough stones leave it; the stone face proper starts within 35 mm of the line everywhere.
- Inside its outline each stone is its own piece of rock: its own tone within one family, its own face (pitched, chisel-dressed, a spalled corner, a shallow hollow), its own few marks. No two neighbours alike, and no single stone so dark, bright or marked that it becomes the thing the eye finds repeating every 3 m.

## What excellent looks like

The bar to beat is the wood plank wall in `/home/user/dev/SNARK/.claude/worktrees/agent-a2517e755af91bae1/planning/artist-test/wood/` (start with `checks/layers.jpg`, then its `REPORT.md`): a complete, aligned, tileable layer set with its own build and checks, in which the layers agree to the pixel. Yours should be better: richer stone, more convincing mortar, and it must read as a built wall at arm's length and from across a valley.

- Colour: weathered limestone, warm grey. Stones vary from a cool blue-grey to a pale buff, within one family, roughly sRGB 115 to 190 in value. Lime mortar a little lighter and warmer than the stone but dulled with grime in the recess. Faint weathering that a wall that has stood for years has: lichen specks, a few rain streak stains running down from joints, slightly darker lower edges where dirt collects. No moss carpets, no cracks through the wall, no graffiti, no bricks.
- The mean of the whole base colour picture must be within 8 levels of sRGB (150, 151, 152) in each channel: the game draws distant walls in that one flat colour, so the textured wall must average to it.
- Flat and unlit: no baked light direction, no cast shadows, no highlight, no gradient across the tile. The relief belongs in the height and normal maps; ambient occlusion in the base colour only as a faint darkening deep in the mortar.

## What the engine needs

All at 2048 by 2048, pixel-aligned with each other and with the layout, every one tiling in both directions:

1. `masonry_base.png`: base colour, RGB, 8 bits, sRGB.
2. `masonry_height.png`: greyscale, 16 bits, white high. Black to white is 32 mm. Stone faces high with 4 to 10 mm of rough relief, mortar about 18 mm below the faces.
3. `masonry_normal.png`: tangent-space normal, RGB 8 bits, OpenGL convention (+X right, +Y up the picture, +Z out), computed from the delivered height at the true scale: the tile is 3 m across 2048 pixels, 1.465 mm a pixel. It must agree with the height.
4. `masonry_orm.png`: one packed picture, RGB 8 bits, linear. Red: ambient occlusion, mostly white, darker only in cavities and mortar. Green: roughness, stone about 0.75 to 0.95, mortar 0.9 to 1.0. Blue: metalness, 0 everywhere.

The image tool returns pictures of about 1,254 pixels whatever you ask for. Reaching 2,048 with real detail is part of the job: one way that worked is generating elements and placing them in a larger master, or adding fine detail by script. Choose your own way, and say how you did it.

## Checks you run and keep in `checks/`

- `tiled3x3.jpg`: the base colour tiled 3 by 3, seen whole. Look at it as a player would look at a long wall: if the repeat jumps out, change the stones that make it.
- `offset.jpg`: each layer offset by half with wrap-around, to see the seams.
- `registration.jpg`: the layout's lines drawn over the base colour, and a measure of how far your joints lie from them.
- `layers.jpg`: all four layers side by side.
- `relit.jpg`: the base colour lit through the normal map from three or four directions.

Then look at what you made and send it back to yourself until a wall of it looks built by hand. Finish with `REPORT.md`: for each file how it was made, what you checked and saw, the mean colour, how long it took, and anything you are not satisfied with. Write plainly.
