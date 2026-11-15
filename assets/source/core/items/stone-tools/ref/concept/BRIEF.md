You are painting the concept design of three hand tools for a game. Work only in the current folder. Do not run git commands that write.

## What the pictures are for

A survival game starts every player with nothing. In the first minutes they pick up a stick, a rock and some plant fibre and make three tools: a **stone pick** (for breaking rock and getting flint), a **stone hatchet** (for chopping wood and skinning) and a **spear** (a weapon, also thrown). They are the first things a player holds, and in first person they sit at the bottom of the screen closer than anything else in the game, for hours. They are also small pictures in the inventory, 64 pixels a side.

Your pictures are the design. After you, a modeller builds the three low-poly 3D meshes straight from your orthographic views, and a material painter makes the wood, fibre and stone surfaces from your colours. So the views must be exact enough to model from, consistent enough that the side, edge and end views describe one object, and beautiful enough to put on a studio wall.

They are our own design. Do not search the web, and do not look at any pictures of tools from games. Work from this description. In your image prompts describe the tools in your own words and do not name any game, studio or franchise.

## The look

The game's style is readable, chunky low-poly with realistic matte surfaces: forms built from big, clean, flat facets you could count, carrying fine natural detail in their surfaces. A little playful, never cartoonish. Think of a well-made hand-crafted object, slightly exaggerated so it reads at a glance.

**What the three share (keep all of these):**

1. Made from what lies on the ground: a stick, a rock, plant fibre. Nothing sawn, nailed or forged. No metal, paint, feathers, beads, leather or grip wraps.
2. Three materials, always the same three: a pale, unpainted wooden haft; a binding of tan plant-fibre cord wound round the joint; a knapped stone head.
3. The binding is the visual centre: a thick, tight wad of wound cord, wider than the haft, that clearly holds the head on.
4. Dull, natural colours.

**Our own choices (paint these exactly; they are what make the tools ours):**

- **Chunky.** The heads are about 15% fatter than a real tool's would be.
- **Knapped stone shown as big flat flake facets** (about six to twelve visible on a face), each facet with faint concentric ripples, the ridges between facets crisp. This is the low-poly look and the modeller will follow your facets.
- **The haft is a stripped branch, not a dowel.** A slight kink, one sawn-off twig stub, a flared butt where it was broken from the tree, one small patch of dark bark left on, the wood worn paler and smoother where the hand holds it.
- **A figure-eight binding with two loose tails.** On the pick and the hatchet the cord crosses over the head in an X on each side and winds tightly round the haft just above and just below the head. Two cut cord ends stick out of the lower wrap, about 3 cm, stiff and slightly splayed. On the spear the binding is a plain tight wrap with an X over the base of the point, and its ends are a short stiff tuft.
- **A pale fresh edge.** Where flint is knapped its edge is lighter than its face: the hatchet's cutting edge and the spear point's two edges carry a pale band about 8 mm wide. The pick's point is worn pale for its last 2 cm. This is the one bright accent on each tool.
- **The pick's point curves a little**, like a beak, its tip bending about 2.5 cm back toward the handle.
- **The pick is grey stone; the hatchet and the spear are dark flint**, with a small patch of pale chalky cortex (the rind of the flint nodule) left on the hatchet's back and on one face of the spear point.

## Colours (natural tones, matte)

| Part | Colour |
|---|---|
| Haft wood | warm honey tan, about #A4784C; worn grip paler and smoother, about #B88C5C; grain darker streaks |
| Bark patch | dark grey-brown, about #4E3828 |
| Binding cord | straw tan with a faint green cast, about #B09858; darker in the grooves between turns |
| Pick stone | cool mid grey, about #807E78, slightly speckled; worn tip about #A8A49C |
| Flint (hatchet, spear) | dark blue-grey-brown, about #4A484C, slightly glassy; fresh edges about #9C9890 |
| Flint cortex | chalky off-white, about #C8BCA4 |

## Sizes and axes

Metres. Each tool's **grip point** (the middle of where the hand closes on it) is the origin. The tool's **length** runs along **+Z** from the grip toward the head. **+Y** is the side that strikes: the pick's point, the hatchet's edge. +X is the tool's flat side, so the pick and hatchet are mirror symmetric across the YZ plane, near enough, and the spear's point lies flat in the XZ plane.

**Stone pick**
- Haft from z = -0.12 (butt) to z = +0.385 (top). About 30 mm thick at the grip, the butt flaring to 38 mm over its last 25 mm, tapering to 27 mm under the head. A kink bows the haft about 6 mm toward -Y around z = 0.15. A twig stub at z = 0.10, on the -Y side, 12 mm long and 10 mm thick, cut flat. The bark patch near z = 0.20.
- Head: one grey stone lashed across the haft, its middle at z = 0.31. Its point toward +Y, the tip at y = +0.185, curving back toward -Z by 25 mm. Its back toward -Y, blunt and squarish, ending at y = -0.075. At the haft it is about 46 mm thick in x and 58 mm along z, tapering to the point. Total head length about 0.26 m: deep and blocky, not a thin blade.
- Binding from z = 0.265 to 0.355, about 56 mm across; the haft's rounded top end shows above it, to z = 0.385.

**Stone hatchet**
- Haft as the pick's, but its twig stub at z = 0.03 on the +X side, and its kink toward +Y.
- Blade: a flat flint wedge set through a split in the haft at z = 0.29. Its edge toward +Y, convex, at y = +0.115 in its middle, running along z from 0.225 to 0.365 (0.14 m). It narrows toward the haft, where it is 0.08 m along z. Its back (with the cortex) shows about 20 mm behind the haft, to y = -0.035. About 24 mm thick in x at the haft, thinning to about 3 mm at the edge.
- Binding: a tight wrap round the haft just below the blade (z = 0.22 to 0.25) and just above it (z = 0.335 to 0.36), and the cord crossing diagonally over the blade's root in an X on both faces. The tails come out of the lower wrap.

**Spear**
- Shaft from z = -0.60 (butt, rounded) to z = +1.30, 26 mm thick at the butt, 28 mm at the grip, 22 mm at the head end. A very slight even bow of about 8 mm. Straighter and plainer than the pick's haft: one small knot near z = 0.6, no stub.
- Point: a leaf-shaped flint point, its tip at z = +1.47, widest (52 mm across x) at z = 1.33, 13 mm thick in y, its base set into the split end of the shaft at z = 1.25.
- Binding from z = 1.20 to 1.29, about 34 mm across, with the tuft of cord ends at its lower end, sticking out about 35 mm and back toward the butt.

## Views to deliver

Every view is a true orthographic projection (no perspective) on a 1254 x 1254 canvas, in flat neutral light: even, soft, frontal, with only gentle form shading; no strong key light, no rim light, no cast or ground shadow, no reflections. One flat even background, light warm grey RGB (214, 212, 206), the same in every picture. No text anywhere except on check sheets.

**Stone pick and stone hatchet**, each at **2000 pixels per metre**, origin (the grip point) at **column 400**:
- `<tool>_side.png`: seen from +X. Z to image right (butt on the left, head on the right), +Y up the image. Haft axis (y = 0) at row 760.
- `<tool>_edge.png`: seen from +Y, looking down onto the striking side. Z to image right, +X up the image. Haft axis at row 627.
- `<tool>_end.png`: seen from +Z, looking down the haft from the head end. +Y up the image, haft axis at column 627, row 760.

Use `pick` and `hatchet` for `<tool>`.

**Spear:**
- `spear_side.png` and `spear_edge.png`: the whole spear at **560 pixels per metre**, origin at **column 376**, axis at **row 627**. Side seen from +X (Z right, +Y up); edge seen from +Y (Z right, +X up).
- `spear_head_side.png`, `spear_head_edge.png`: the head end only, at **2000 pixels per metre**, z = 1.10 at column 247 (so z = 1.47 is at column 987), axis at row 627. The same two directions.
- `spear_head_end.png`: seen from +Z, at 2000 pixels per metre, axis at column 627, row 627.

**And:**
- A `_mask.png` for each view above: the tool's silhouette, white on black, same canvas, matching the colour view exactly.
- `lineup.png`: the three tools side by side at one scale, side views, on the same background, so their sizes compare. Any layout.
- `hero.png`: the three lying together on a plain neutral surface, seen from above at three quarters, with soft daylight and a soft shadow, showing what they are made of up close. Perspective is fine here.
- `read_sizes.png`: each tool's side view at 128, 64 and 32 pixels across its longest side, and its black silhouette at the same sizes, on one sheet. This is how they must read as inventory pictures. The pick and the hatchet must be told apart at 32 pixels.
- `checks/`: your measurements as JSON, and the overlay sheets you made.
- `REPORT.md`: how each picture was made, what you measured, how many rounds, how long it took, what you are not satisfied with. Keep every script in this folder so the work can be rebuilt.

## What must hold

- **The views agree.** For each tool, the side, edge and end views describe one object: every length along z in the side view matches the edge view within 2% of the tool's length; heights in the side view match the end view and widths in the edge view match the end view within 3 mm. Each facet, wrap, tail, stub and bark patch is the same in every view where it shows. Measure it, draw guide lines across the views side by side and look. If a view disagrees, fix it or make it again; do not stretch a drawing to fit.
- **The sizes hold.** Measure the tip, edge, butt, binding and head extents in pixels and convert to metres: within 5% of the numbers above.
- **Nothing added** beyond what is described.

## What excellent looks like

Prop concept art a studio would pin to its wall: three objects you instantly believe someone made with their hands that morning, and that read in one glance even as black shapes 32 pixels across: the pick a heavy grey point on a stick, the hatchet a dark flag of flint, the spear a long line with a leaf at its end. Up close, crisp knapped facets with conchoidal ripples, glassy dark flint against chalky cortex and a pale fresh edge, tight twisted cord with a real figure-eight, honest grained wood worn smooth at the grip. Someone who has played survival games should recognise each tool immediately, and on a second look see it is its own design.

Look at every picture you make, compare the views against one another and against this description, and keep going until they agree and you would stand behind them.
