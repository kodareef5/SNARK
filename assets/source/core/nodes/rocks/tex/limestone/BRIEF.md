# Limestone: the surfaces of the coast's boulders

You are making the surface materials of the pale coastal limestone boulders in a survival game, and you have the whole job: generation, every layer, your own build and check scripts, looking at the result and fixing it. Work only in this folder. Python 3 with Pillow, NumPy and SciPy is installed. Keep every picture the image tool gives you in `source/`, and every prompt you used in `prompts.md`.

## What they are for

The game is set on a ruined, overgrown subtropical coast. Its bedrock is oolitic and coral limestone, and its boulders and outcrops are among the first things a player looks for: struck with a pick they give stone and flint, and a player hides behind them and climbs onto them. The concept art for them is in `../../ref/concept/` (start with `limestone.png` and `shore.png`, and read `NOTES.md` there when it exists): that is the look to reach. Every boulder is modelled as a solid whose large forms (the block, the bedding ledges and cracks, the solution cups and holes down to about 3 cm) are real geometry. Your materials are the skin laid over that geometry: everything finer than about 3 cm, and all of the colour.

How they are used: each material is projected onto the boulder's sculpted surface from three sides and blended, then baked with the boulder's own occlusion and weathering masks into one picture per boulder. So each must tile seamlessly in both directions, must look right at any rotation and from any side (no up or down in it, no light direction, no shadows), and must not show its repeat when it covers a 3 m boulder twice over.

## The materials

1. **weathered** — the weathered face of the stone, the skin of most of every boulder. Porous oolite and coral limestone eaten by rain and sea spray: pitted all over with pores and small vugs from a millimetre to two or three centimetres, sharp little ridges and points between them, a few fossil shell fragments and coral pieces weathered out in relief, no smooth patches. Cream to buff to pale warm grey, varying in soft patches. Two base colours over one relief:
   - `weathered_base.png`: the clean skin, as the sides of a boulder are.
   - `weathered_crust_base.png`: the same skin as the exposed tops are, under the grey to blackish weathering crust that coastal limestone grows: grey-black in the pits and on the points, with the buff still showing through on the ridges in places. Pixel for pixel the same stone as the clean one, so the two can be blended by a mask without the relief jumping.
2. **fresh** — a fresh break, where a pick has split the stone: pale cream, crisper, conchoidal and hackly in small facets, with ooids and fossil fragments (shell, bits of coral, a small gastropod) showing in section and a few open pores. This is what a used-up boulder's broken top and its fallen pieces show.

Each material is 1.5 m across one picture.

## What excellent looks like

Our own example of the bar is the stone tier's wall stone in `/home/user/dev/SNARK/.claude/worktrees/agent-a9b3d7ade17206da2/assets/source/core/structures/stone/tex/masonry/` (look at its pictures and read its `REPORT.md`): a complete, aligned, tileable layer set with its own build and checks, in which the layers agree to the pixel. Yours should be as good: a stranger looking at a patch of it should see real porous limestone, not a noise pattern, and the crusted version should look like the same rock after years of sun and spray.

- Colour, as the sides of the concept boulders: the clean skin averages roughly sRGB (196, 178, 140), with cooler grey patches and warmer ochre ones within a family; the crust roughly (120, 116, 106) overall; the fresh break roughly (222, 208, 176). Flat and unlit: no light direction, no cast shadow, no highlight, no gradient across the picture. Ambient occlusion only as a faint darkening deep in pores.
- Relief: the height is black to white over 40 mm. Pores and vugs read clearly in it, deep and steep-sided; the ridges between them sharp.

## What to deliver, in this folder

For each of `weathered` and `fresh`, at 2048 by 2048, pixel-aligned, each tiling in both directions:

- `<name>_base.png` (and `weathered_crust_base.png`): base colour, RGB 8 bits, sRGB.
- `<name>_height.png`: greyscale, 16 bits, white high, 40 mm black to white.
- `<name>_normal.png`: tangent-space normal, RGB 8 bits, OpenGL (+X right, +Y up the picture, +Z out), from the delivered height at its true scale (1.5 m across 2048 pixels).
- `<name>_rough.png`: roughness, greyscale 8 bits, linear: about 0.8 to 1.0, a little lower on the crust's smoothed points.

The image tool returns pictures of about 1,254 pixels whatever you ask for. Reaching 2,048 with real detail is part of the job: generating elements and placing them in a larger master, or adding fine detail by script, has worked. Choose your own way, and say how you did it.

## Checks you run and keep in `checks/`

- `tiled3x3.jpg` of each base colour: if a repeat jumps out, change what makes it.
- `offset.jpg`: each layer offset by half with wrap-around, to see the seams.
- `layers.jpg`: all layers side by side.
- `relit.jpg`: each base colour lit through its normal from three or four directions, at a size where a pore is a few pixels.
- `blend.jpg`: the clean and crusted skins blended by a soft mask, to show they are one stone.

Then look at what you made and send it back to yourself until it looks like the rock in the concept art. Finish with `REPORT.md`: for each file how it was made, what you checked and saw, the mean colours, and anything you are not satisfied with. Write plainly.
