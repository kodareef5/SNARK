# Iron: the fittings of a stronghold door

You are making one tiling material for a survival building game, and you have the whole job: generation, every layer, your own build and check scripts, looking at the result and fixing it. Work only in this folder. Python 3 with Pillow, NumPy and SciPy is installed. Keep every source picture the image tool gives you in `source/`, and every prompt you used in `prompts.md`.

## What it is for

The stone tier's door is thick oak bound with iron: straps across it, strap hinges, rows of rivet heads, a ring to pull it. This material is all of that iron. The game models every strap, rivet and ring as real geometry, edges included, and cuts each from a part of this tile. So this picture has no edges, no straps, no rivets and no bolts: it is one continuous surface of hand-forged iron, 3 m by 3 m, tiling in both directions with no seam.

## What excellent looks like

The bar to beat is the wood plank wall in `/home/user/dev/SNARK/.claude/worktrees/agent-a2517e755af91bae1/planning/artist-test/wood/` (start with `checks/layers.jpg`, then its `REPORT.md`): a complete, aligned, tileable layer set with its own build and checks, in which the layers agree to the pixel, and whose metal is marked in the packed map. Yours should be better.

- Wrought iron worked by a smith: overlapping hammer dimples 5 to 20 mm across, a little forge scale, the faint fibrous streak wrought iron has, along u. Mostly near black with a dull oily sheen where hands and weather have polished it; rust in patches, in pits and spreading in soft blooms, from dark brown to a little orange, never covering more than about a fifth of it.
- A strip 30 to 80 mm wide cut from anywhere must look like a forged strap. No feature so striking that it marks a repeat.
- Colour: the mean of the whole base colour picture must be within 10 levels of sRGB (44, 41, 39) in each channel.
- Flat and unlit: no baked light direction, no cast shadows, no highlight, no gradient across the tile. The base colour of bare metal is its reflectance: a dark grey, not black.

## What the engine needs

All at 2048 by 2048, pixel-aligned with each other, every one tiling in both directions:

1. `iron_base.png`: base colour, RGB, 8 bits, sRGB.
2. `iron_height.png`: greyscale, 16 bits, white high. Black to white is 3 mm.
3. `iron_normal.png`: tangent-space normal, RGB 8 bits, OpenGL convention (+X right, +Y up the picture, +Z out), computed from the delivered height at the true scale: the tile is 3 m across 2048 pixels, 1.465 mm a pixel. It must agree with the height.
4. `iron_orm.png`: one packed picture, RGB 8 bits, linear. Red: ambient occlusion, nearly white. Green: roughness, polished iron about 0.35 to 0.5, plain iron 0.5 to 0.7, rust 0.8 to 1.0. Blue: metalness, 1 on bare iron, falling to 0.2 or less under thick rust.

The image tool returns pictures of about 1,254 pixels whatever you ask for. Reaching 2,048 with real detail is part of the job: one way that worked is generating elements and placing them in a larger master, or adding fine detail by script. Choose your own way, and say how you did it.

## Checks you run and keep in `checks/`

- `tiled3x3.jpg`: the base colour tiled 3 by 3, seen whole. If the repeat jumps out, change what makes it.
- `straps.jpg`: a dozen strips 30 to 80 mm wide and 0.5 to 1.4 m long cut from random places, each drawn as a strap would be.
- `offset.jpg`: each layer offset by half with wrap-around, to see the seams.
- `layers.jpg`: all four layers side by side.
- `relit.jpg`: the base colour lit through the normal map from three or four directions, as a metal would be.

Then look at what you made and send it back to yourself until you would ship it. Finish with `REPORT.md`: for each file how it was made, what you checked and saw, the mean colour, how long it took, and anything you are not satisfied with. Write plainly.
