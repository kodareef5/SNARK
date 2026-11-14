You are making one tiling material for the building pieces of a survival game. Work only in the current folder. Do not run git commands that write.

## What it is for

Players build their bases out of a few thousand wooden pieces: foundations, walls, doorframes, ceilings, stairs, pillars, doors. This is the wood tier, "a proper house": sawn planks on a frame of heavy timber, pegged and nailed, with iron where it bears weight. Four materials are being made for it, one each, and they are used together on every piece: `boards` (the wall weatherboards, honey to warm mid-brown), `deck` (weathered grey-brown floorboards), `timber` (the heavy dark-brown frame) and `fittings` (this one).

**This material: `fittings`, the small parts that say how it is held together.** A trim sheet with two halves: the sawn ends of the heavy timbers (where a beam end shows at a corner, the top of a post, the end of a joist), and the wrought iron that holds the frame together (straps across joints, corner brackets, door hinges, bands round a pillar, cap plates). Small parts, seen close, so this one has four times the pixel density of the others.

## The layout (exact: the 3D pieces are mapped to it)

- **One tile covers 1 m by 1 m.** 2,048 by 2,048 pixels, 2,048 pixels a metre.
- **Top half, rows 0 to 1023: end grain.** Four columns by two rows of cells, each exactly 512 by 512 pixels (0.25 m square). Each cell is the sawn end of one squared timber of the same wood as the frame (a dense, darkened oak-like wood): growth rings, the pith off-centre in some (a boxed heart in others, quarter-sawn in one), radial drying checks running in from the edges, faint saw marks across the face, the outer centimetre slightly rounded and darker where the arris is worn. Two or three cells have a round oak peg (treenail) end in them, about 2.5 cm across, a little lighter and a hair proud. A beam end in the game is mapped onto one cell, centred, so the cell edges are the beam's edges. The cells do not need to join one another, but their outermost few pixels must be the rounded dark arris and nothing else.
- **Bottom half, rows 1024 to 2047: wrought iron.** Six horizontal bands, each tiling left to right on its own (1 m wraps to itself):
  - rows 1024 to 1279 (0.125 m): heavy hammered iron plate, blackened, with hammer facets and a little rust;
  - rows 1280 to 1407 (6.25 cm): an iron strap with a domed rivet or bolt head (about 1.6 cm across) centred every 0.125 m, at x = 128, 384, 640, ... 1920;
  - rows 1408 to 1535: a plain forged strap, hammer marks, the edges slightly irregular;
  - rows 1536 to 1663: a strap with square forged nail heads (about 1.2 cm) every 0.125 m at the same x positions, more rust;
  - rows 1664 to 1791: a plain strap, rustier, with a little pitting;
  - rows 1792 to 2047 (0.125 m): heavy plate again, rustier than the first.
  Each strap band's top and bottom rows are the strap's own edges: a rounded or bevelled edge in the height, slightly darker. A strap in the game is mapped onto one band exactly, so the band edge is the strap's edge.

## What the files must be

All 2,048 by 2,048, pixel-aligned with one another, PNG:

1. `fittings_base.png`: base colour, 8-bit sRGB. Flat and unlit: no baked light, no occlusion, no gradient. For iron, the base colour is the metal's reflectance colour (dark grey, about sRGB 70 to 90) and rust is a non-metal orange-brown; the end grain averages roughly sRGB (110, 78, 52).
2. `fittings_height.png`: 16-bit greyscale height, white high. State in the report the physical range the full 0..65535 covers, in millimetres.
3. `fittings_normal.png`: tangent-space normal, 8-bit, OpenGL convention (+X right, +Y up the image, +Z out), computed from the height at that physical scale and agreeing with it.
4. `fittings_orm.png`: 8-bit linear, red ambient occlusion, green roughness, blue metalness: 255 on bare and blackened iron, falling to 0 in rust; 0 on all the end grain.

## What excellent looks like

- Close up (a player at a door, its hinge strap filling a good part of the screen), convincing hand-forged iron: hammer facets, slightly irregular edges, domed rivets that catch light, rust in the low places and round the rivets, not a uniform grey; and end grain you could count the rings on, with checks that have depth.
- On a small strap 6 cm wide seen from a few metres, it still reads as iron with rivets, not as a grey stripe.
- The layers agree. Rivet heads and nail heads are high, crisp and metal; rust is rough and non-metal; occlusion round rivet bases, in checks and pits.

## The example to beat

A wood wall material from an earlier test is at `/home/user/dev/SNARK/.claude/worktrees/agent-ae515c340350f410b/planning/artist-test/wood/` (look at `checks/layers.jpg`, `wood_orm.png`, `REPORT.md`). It is good: aligned, seamless, honest, and its iron nails are correctly metal in the packed map. Beat it: its iron is a few flat grey dots and its relief is shallow. Yours should hold up at four times its density.

## How

Your method, your tools. Python 3 with Pillow, numpy and scipy is installed. The image tool returns pictures of about 1,254 pixels a side whatever you ask for; in the test, 2,048 was reached by generating elements and placing them in a larger master, or by adding fine detail by script. Generating the end grain cells and the iron as separate sources and assembling the sheet from them is one good way. Keep every generated source in `source/` at full size, and your scripts in this folder, so the whole thing can be rebuilt.

Check your own work and fix what you see:
- offset each iron band by half its length with wrap-around and look at the seam; tile the iron half 3 across;
- check every cell and band sits exactly on its lines and the rivets where stated;
- recompute the normal from the saved height and compare;
- draw the layers side by side and a simple lit preview from two light directions;
- put a contact sheet of these in `checks/`.

Finish with `REPORT.md`: each file, how it was made, what you checked and saw, the height range in mm, the metres per tile, how long it took, and anything you are not satisfied with.
