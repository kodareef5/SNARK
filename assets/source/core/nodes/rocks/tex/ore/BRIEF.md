# The ore rock: the surfaces of the stone that gives metal

You are making the surface materials of the ore-bearing rocks in a survival game, and you have the whole job: generation, every layer, your own build and check scripts, looking at the result and fixing it. Work only in this folder. Python 3 with Pillow, NumPy and SciPy is installed. Keep every picture the image tool gives you in `source/`, and every prompt you used in `prompts.md`.

## What they are for

The game is set on a ruined, overgrown subtropical coast whose bedrock is pale limestone. Among the limestone a darker, harder stone pushes up, and it carries metal ore: struck with a pick it gives metal, and finding it is a small triumph a player learns to spot from far off, by its dark colour among the pale rocks and by the glint of its veins in the sun. It must never glow or sparkle like a crystal: it is a rock that rewards a good eye. The concept art is in `../../ref/concept/` (start with `ore.png` and `hillside.png`, and read `NOTES.md` there when it exists): that is the look to reach.

Every ore rock is modelled as a solid whose large forms (its facets, fractures, the veins' paths, steps and chips down to about 3 cm) are real geometry. Your materials are the skin laid over that geometry: everything finer, and all of the colour. Each material is projected onto the rock's sculpted surface from three sides and blended, then baked with the rock's own occlusion and masks (where the veins run, where rust has bled down) into one picture per rock. So each must tile seamlessly in both directions, look right at any rotation, carry no light direction, and not show its repeat over a 3 m rock.

## The materials

1. **stone** — the weathered skin of the dark stone: dense, hard, fine-grained, like a dark greenstone or ironstone. Smooth-skinned and massive compared with the pitted limestone, with small hackly chips, fine crystalline speckle, faint hairline cracks and a slightly worn sheen; dark grey-green to blue-black, mottled within that family. Averages roughly sRGB (74, 76, 70).
2. **fresh** — the same stone freshly broken by a pick: a little lighter and greyer, crisper, with conchoidal and hackly fracture facets and glittering fine grain. Averages roughly (98, 100, 96).
3. **vein** — the ore itself, as it fills the veins and seams: massive brassy-gold sulphide ore with quartz, crystalline and blocky, with a little dark tarnish and rusty brown at its edges. It is metal: roughness and metalness layers matter most here, so that it catches the sun the way brass does and not the way glitter does.
4. **rust** — the rust that bleeds down the stone from the veins: a stain in streaks and drips, orange-brown to dark umber, which the bake lays over the stone along each rock's own streak lines. Deliver it as a base colour and a coverage layer (where the stain is thick and where it thins to nothing), tiling, with the streaks running down the picture: this one material does have an up and a down.

Each material is 1.5 m across one picture.

## What excellent looks like

Our own example of the bar is the stone tier's wall stone in `/home/user/dev/SNARK/.claude/worktrees/agent-a9b3d7ade17206da2/assets/source/core/structures/stone/tex/masonry/` (look at its pictures and read its `REPORT.md`): a complete, aligned, tileable layer set with its own build and checks, in which the layers agree to the pixel. Yours should be as good: real hard rock and real ore, not a noise pattern with gold paint.

Flat and unlit: no light direction, no cast shadow, no highlight, no gradient across the picture. Ambient occlusion only as a faint darkening deep in cracks.

## What to deliver, in this folder

For each of `stone`, `fresh` and `vein`, at 2048 by 2048, pixel-aligned within a material, each tiling in both directions:

- `<name>_base.png`: base colour, RGB 8 bits, sRGB.
- `<name>_height.png`: greyscale, 16 bits, white high, 20 mm black to white.
- `<name>_normal.png`: tangent-space normal, RGB 8 bits, OpenGL (+X right, +Y up the picture, +Z out), from the delivered height at its true scale (1.5 m across 2048 pixels).
- `<name>_rough.png`: roughness, greyscale 8 bits, linear: the stone about 0.55 to 0.8, the ore 0.25 to 0.5.
- `vein_metal.png`: metalness, greyscale 8 bits: 1 on the sulphide, 0 on the quartz and the tarnish.

For `rust`: `rust_base.png` and `rust_cover.png` (greyscale, white where the stain is full), 2048 by 2048, tiling.

The image tool returns pictures of about 1,254 pixels whatever you ask for. Reaching 2,048 with real detail is part of the job: generating elements and placing them in a larger master, or adding fine detail by script, has worked. Choose your own way, and say how you did it.

## Checks you run and keep in `checks/`

- `tiled3x3.jpg` of each base colour, `offset.jpg` of each layer offset by half with wrap-around, `layers.jpg` of all layers side by side.
- `relit.jpg`: each material lit through its normal from three or four directions, with the vein's roughness and metalness used so its glint shows.
- `together.jpg`: a square metre of stone with a vein running through it and rust bled below it, blended by simple masks of your own, to show the three belong to one rock.

Then look at what you made and send it back to yourself until it looks like the rock in the concept art. Finish with `REPORT.md`: for each file how it was made, what you checked and saw, the mean colours, and anything you are not satisfied with. Write plainly.
