You are making one tiling material for the building pieces of a survival game. Work only in the current folder. Do not run git commands that write.

## What it is for

Players build their bases out of a few thousand wooden pieces: foundations, walls, doorframes, ceilings, stairs. This is the wood tier, "a proper house": sawn planks on a frame of heavy timber, pegged and nailed, with iron where it bears weight. Four materials are being made for it, one each, and they are used together on every piece: `boards` (the wall weatherboards), `deck` (this one), `timber` (the heavy frame) and `fittings` (end grain and iron).

**This material: `deck`, the floorboards, and the tier's weathered variant.** The tops of foundations and ceilings, which are the floors of every base, and the treads of stairs. Thick sawn boards laid side by side with narrow gaps, face-nailed to joists below. They are walked on and rained on: weathered and worn, the surface silvering to a warm grey-brown, the soft grain worn down so the hard latewood rings stand a little proud, dirt in the gaps, the edges rounded by feet, a few darker water stains and boot-scuffed patches. Still the same wood as the walls (warm undertone), just older and more used. It should sit beside the warm wall boards as clearly the floor: a little lighter and greyer, cooler, more textured.

## The layout (exact: the 3D pieces are modelled to it)

- **One tile covers 3 m by 3 m of floor.** 2,048 by 2,048 pixels, about 683 pixels a metre. Image x runs along the boards.
- **Exactly 12 boards**, each exactly 1/12 of the tile wide (0.25 m, 170.67 pixels). Board k occupies rows k*2048/12 to (k+1)*2048/12. The gap between boards is centred on each of those lines (and on the top/bottom wrap line), about 6 mm wide (4 pixels), dark, with dirt in it. Edges may fall between pixels; antialias them.
- **Joists** run across under the boards at x = 0, 512, 1024 and 1536 (every 0.75 m). Each board has two nails on every joist line it crosses, about 5 cm in from each of its edges: forged iron nails with square heads about 1.2 cm across (8 pixels), set flush or a little sunk, with dark iron staining in the grain around them. Metal in the packed map. The nails on x = 0 straddle the wrap.
- **Butt joints**: boards are of different lengths, so their end joints are staggered: each board has one or two end-to-end joints, always on a joist line (x = 0, 512, 1024 or 1536), and no two neighbouring boards have a joint on the same line. A joint is a hairline gap with darker end grain each side and the board ends a little more worn. Where a joint is, the board has a nail pair each side of it.
- It must tile seamlessly both ways.

## What the files must be

All 2,048 by 2,048, pixel-aligned with one another, PNG:

1. `deck_base.png`: base colour, 8-bit sRGB. Flat and unlit: no baked light, no occlusion, no shadows, no gradient. Mean colour roughly sRGB (138, 116, 92), give or take.
2. `deck_height.png`: 16-bit greyscale height, white high. State in the report the physical range the full 0..65535 covers, in millimetres.
3. `deck_normal.png`: tangent-space normal, 8-bit, OpenGL convention (+X right, +Y up the image, +Z out), computed from the height at that physical scale and agreeing with it.
4. `deck_orm.png`: 8-bit linear, red ambient occlusion, green roughness, blue metalness (255 on the nail heads, 0 elsewhere).

## What excellent looks like

- Up close (a player looks down at the floor at their feet, about 700 to 1,000 pixels a metre), worn real wood: raised weathered grain, a few checks, rounded board edges falling into the gaps, crisp nails, dirt packed into the gaps and joints. Detail that is native at 2,048, not an upscale.
- From a distance (a foundation of 3 m is a few dozen pixels), a floor of clear boards with gentle tonal variety from board to board, no single stain or knot that shouts when it repeats every 3 m across a big base.
- The layers agree. Roughness varies: high on weathered wood, a bit lower where feet have polished it, high in the dirty gaps. Occlusion in the gaps, joints, deep checks and around nails, never whole-board darkening.

## The example to beat

A wood wall material from an earlier test is at `/home/user/dev/SNARK/.claude/worktrees/agent-ae515c340350f410b/planning/art-trial/wood/` (look at `checks/layers.jpg`, `checks/tilings.jpg`, `wood_base_2048.png`, `REPORT.md`). It is good: aligned, seamless, honest. Beat it. Its weaknesses: every plank is the same grey-brown so it reads as one printed sheet; its relief is shallow and its nails are small dots; its 2,048 is its 1,024 resampled with added fibres. Yours should look like real floorboards that have been walked on for years, with native detail at 2,048.

## How

Your method, your tools. Python 3 with Pillow, numpy and scipy is installed. The image tool returns pictures of about 1,254 pixels a side whatever you ask for; in the test, 2,048 was reached by generating elements (a board, a set of boards) and placing them in a larger master, or by adding fine detail by script. Generating the boards as several separate sources and assembling the 12 from them is one good way to get variety and native resolution. Keep every generated source in `source/` at full size, and your scripts in this folder, so the whole thing can be rebuilt.

Check your own work and fix what you see:
- offset by half the tile with wrap-around and look at the seams; tile it 3 by 3 and look at it small and large;
- check the gaps sit on the 12 lines and the nails and joints where stated;
- recompute the normal from the saved height and compare;
- draw the layers side by side and a simple lit preview from two light directions;
- put a contact sheet of these in `checks/`.

Finish with `REPORT.md`: each file, how it was made, what you checked and saw, the height range in mm, the metres per tile, how long it took, and anything you are not satisfied with.
