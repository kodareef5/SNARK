You are making one tiling material for the building pieces of a survival game. Work only in the current folder. Do not run git commands that write.

## What it is for

Players build their bases out of a few thousand wooden pieces: foundations, walls, doorframes, ceilings, stairs, pillars. This is the wood tier, "a proper house": sawn planks on a frame of heavy timber, pegged and nailed, with iron where it bears weight. Four materials are being made for it, one each, and they are used together on every piece: `boards` (the wall weatherboards, honey to warm mid-brown), `deck` (weathered grey-brown floorboards), `timber` (this one) and `fittings` (end grain and iron).

**This material: `timber`, the heavy frame.** The long faces of the big squared timbers that hold a building up: the corner posts of every wall, the sill and top plates, the knee braces, door jambs and lintels, the rim beams of foundations, ceiling joists, stair stringers and pillars. Oak or a dense softwood, squared by axe and adze or pit-sawn, oiled and darkened with age: a deeper, richer, darker brown than the wall boards, so that on every piece the frame reads clearly against the boards it holds. Drying checks (long cracks along the grain), hewing marks, the odd knot, an old empty peg hole.

## The layout (exact: the 3D pieces are mapped to it)

This is a trim sheet that tiles along its length.

- **One tile covers 3 m by 3 m.** 2,048 by 2,048 pixels, about 683 pixels a metre. The grain runs along image x everywhere.
- **Exactly 12 bands**, each exactly 1/12 of the tile tall (0.25 m, 170.67 pixels): band k occupies rows k*2048/12 to (k+1)*2048/12. **Each band is the face of one separate timber**, 3 m long, its own grain and character. A beam face in the game is mapped onto one band, centred on it, so the band edges are the beam's edges: let each band darken and soften slightly into its last centimetre at top and bottom, as the worn, rounded arris of a squared timber does (a gentle rounded edge in the height, a little occlusion), with no hard gap or line between bands.
- **Each band tiles left to right** with its grain carrying across the wrap. Top and bottom wrap at a band boundary.
- Mix the bands: about four hewn (broad shallow scallops of adze or broad-axe marks across the face, the grain undulating with them), about five sawn (faint straight saw striations across the grain), about three in between and more weathered. Two or three bands with a long drying check (40 to 120 cm long, a few mm wide, dark, with depth). A few knots, and one or two old empty peg holes (round, about 2.5 cm across, dark inside). Nothing so distinctive that it shouts when the tile repeats every 3 m.

## What the files must be

All 2,048 by 2,048, pixel-aligned with one another, PNG:

1. `timber_base.png`: base colour, 8-bit sRGB. Flat and unlit: no baked light, no occlusion, no shadows, no gradient across the tile (each band may differ in tone from its neighbours; that is wanted). Mean colour roughly sRGB (104, 72, 48), give or take.
2. `timber_height.png`: 16-bit greyscale height, white high. State in the report the physical range the full 0..65535 covers, in millimetres.
3. `timber_normal.png`: tangent-space normal, 8-bit, OpenGL convention (+X right, +Y up the image, +Z out), computed from the height at that physical scale and agreeing with it.
4. `timber_orm.png`: 8-bit linear, red ambient occlusion, green roughness, blue metalness (all 0: there is no metal in this one).

## What excellent looks like

- At arm's length (a player standing at a door post, about 1,000 pixels a metre on screen), real heavy timber: tight dense grain, hewing scallops you can feel in the normal map, checks with depth, a slightly oily sheen where hands touch (lower roughness), dry and rough elsewhere. Native at 2,048, not an upscale.
- From across a field, a dark, strong frame that outlines every piece: the frame-against-boards contrast is what makes a wall read as a building.
- The layers agree. Occlusion only in real cavities: checks, peg holes, the softened arrises, deep adze marks.

## The example to beat

A wood wall material from an earlier test is at `/home/user/dev/SNARK/.claude/worktrees/agent-ae515c340350f410b/planning/art-trial/wood/` (look at `checks/layers.jpg`, `checks/tilings.jpg`, `wood_base_2048.png`, `REPORT.md`). It is good: aligned, seamless, honest. Beat it. Its weaknesses: every plank is the same grey-brown, its relief is shallow, and its 2,048 is its 1,024 resampled with added fibres. Yours should be twelve different heavy timbers, each believable on its own, with native detail at 2,048.

## How

Your method, your tools. Python 3 with Pillow, numpy and scipy is installed. The image tool returns pictures of about 1,254 pixels a side whatever you ask for; in the test, 2,048 was reached by generating elements and placing them in a larger master, or by adding fine detail by script. Generating the timbers as several separate sources (a few long beam faces per picture) and assembling the 12 bands from them is one good way to get variety and native resolution. Keep every generated source in `source/` at full size, and your scripts in this folder, so the whole thing can be rebuilt.

Check your own work and fix what you see:
- offset by half the tile with wrap-around and look at the seams; tile it 3 by 3 and look at it small and large;
- check the 12 bands sit exactly on their lines;
- recompute the normal from the saved height and compare;
- draw the layers side by side and a simple lit preview from two light directions;
- crop single bands at 0.12 to 0.25 m wide, as a post face would show them, and look at them;
- put a contact sheet of these in `checks/`.

Finish with `REPORT.md`: each file, how it was made, what you checked and saw, the height range in mm, the metres per tile, how long it took, and anything you are not satisfied with.
