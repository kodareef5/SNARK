You are making one tiling material for the building pieces of a survival game. Work only in the current folder. Do not run git commands that write.

## What it is for

Players build their bases out of a few thousand wooden pieces: foundations, walls, doorframes, ceilings, stairs. This is the wood tier, "a proper house": sawn planks on a frame of heavy timber, pegged and nailed, with iron where it bears weight. Four materials are being made for it, one each, and they are used together on every piece: `boards` (this one), `deck` (floorboards), `timber` (the heavy frame) and `fittings` (end grain and iron). This material is what the game looks like most of the time, so it is the most important one.

**This material: `boards`, the weatherboards of the walls.** Horizontal sawn planks, lapped like weatherboarding: each board's lower edge overlaps the top of the board below it. They are nailed to the timber frame behind. It is also used, turned on its side, for the vertical boards of doors and for stair risers and the undersides of ceilings.

The wood: sawn softwood (pine or larch), honey to warm mid-brown, a little sun-faded and weathered but not grey and not rotten: a house someone built well a few years ago. The overall read is warm. A board-to-board change in tone is what makes a wall look built and not printed: some boards a little lighter or more amber, one or two darker or more weathered, a few with knots, each its own grain.

## The layout (exact: the 3D pieces are modelled to it)

- **One tile covers 3 m by 3 m of wall.** 2,048 by 2,048 pixels, so about 683 pixels a metre. Image x runs along the boards, image y runs down the wall.
- **Exactly 12 boards**, each exactly 1/12 of the tile tall (0.25 m, 170.67 pixels). Board k occupies rows k*2048/12 to (k+1)*2048/12. Edges may fall between pixels; antialias them. The 3D pieces put real geometry on these lines, so they must be exactly there.
- **The lap**: the bottom 1 to 1.5 cm of every board (toward larger image y) is its lower edge, which the modelled board tilts outward: the height map gives it a small rounded arris along the bottom (2 to 4 mm drop over the last centimetre), and the top centimetre of every board, which sits tucked under the board above, gets some ambient occlusion in the packed map. There are no open gaps between boards: they lap. Do not paint the lap shadow into the base colour.
- **Nails**: the boards are nailed to a stud behind at the middle of the tile, x = 1024, two nails a board (about 4 cm and 18 cm up from its lower edge, i.e. near the lap). Also a pair at x = 0 (straddling the wrap, so half of each nail sits at each side). Forged iron nails with square or rose heads, about 1.2 cm across (8 pixels), a little proud, with a faint dark iron stain bleeding into the grain around some of them. Metal in the packed map.
- **Butt joints**: boards 2, 5 and 9 (counting from 0 at the top) are two lengths, joined end to end at x = 1024, with a nail pair each side of the joint (so four nails there). The joint is a hairline gap, slightly irregular, with end grain darkening either side. All other boards run the whole tile.
- It must tile seamlessly in both directions: the grain of each board carries across the left-right wrap, and the top board's top meets the bottom board's lap.

## What the files must be

All 2,048 by 2,048, pixel-aligned with one another, PNG:

1. `boards_base.png`: base colour, 8-bit sRGB. Flat and unlit: no baked light, no occlusion, no shadows, no gradient across the tile. Mean colour roughly sRGB (150, 108, 72), give or take; warm.
2. `boards_height.png`: 16-bit greyscale height, white high. State in the report the physical range the full 0..65535 covers, in millimetres.
3. `boards_normal.png`: tangent-space normal, 8-bit, OpenGL convention (+X right, +Y up the image, +Z out), computed from the height at the physical scale above and agreeing with it.
4. `boards_orm.png`: 8-bit linear, red ambient occlusion, green roughness, blue metalness (255 on the iron nail heads, 0 elsewhere).

## What excellent looks like

- At arm's length (a player standing at the wall, about 1,000 pixels a metre on screen), real wood: fibres, saw marks (pit-saw or frame-saw striations across the grain, faint), raised grain, a few small checks, knots that interrupt the grain properly, crisp nail heads. Detail that is native at 2,048, not an upscale of something smaller.
- From across a field (a whole wall a few dozen pixels tall), it reads as clear horizontal boards with a pleasing tonal rhythm: not noise, not a flat colour, no single feature that shouts when the tile repeats every 3 m along a row of walls.
- The layers agree: every edge, knot and nail sits on the same pixels in all four.
- Roughness is not flat: rougher on raised end fibres and weathered patches, a touch smoother on the faces worn by hands and weather; occlusion only in real cavities (the lap, the butt joints, around nail heads, deep checks), never whole-board darkening.

## The example to beat

A wood wall material from an earlier test is at `/home/user/dev/SNARK/.claude/worktrees/agent-ae515c340350f410b/planning/art-trial/wood/` (look at `checks/layers.jpg`, `checks/tilings.jpg`, `wood_base_2048.png`, `REPORT.md`). It is good: aligned, seamless, honest. Beat it. Its weaknesses: every plank is the same grey-brown, so a wall of it reads as one printed sheet; its relief is shallow and its nails are small dots; its 2,048 is its 1,024 resampled with added fibres. Yours should look like boards someone chose and nailed up one by one, with native detail at 2,048.

## How

Your method, your tools. Python 3 with Pillow, numpy and scipy is installed. The image tool returns pictures of about 1,254 pixels a side whatever you ask for; in the test, 2,048 was reached by generating elements (a board, a set of boards) and placing them in a larger master, or by adding fine detail by script. Generating the boards as several separate sources and assembling the 12 rows from them is one good way to get variety and native resolution. Keep every generated source in `source/` at full size, and your scripts in this folder, so the whole thing can be rebuilt.

Check your own work and fix what you see:
- offset by half the tile with wrap-around and look at the seams; tile it 3 by 3 and look at it small and large;
- check the board edges sit on the 12 lines, and the nails and joints where stated;
- recompute the normal from the saved height and compare;
- draw the layers side by side and a simple lit preview from two light directions;
- put a contact sheet of these in `checks/`.

Finish with `REPORT.md`: each file, how it was made, what you checked and saw, the height range in mm, the metres per tile, how long it took, and anything you are not satisfied with.
