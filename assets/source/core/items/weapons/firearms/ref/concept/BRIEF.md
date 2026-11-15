You are painting the concept design of four firearms for a game. Work only in the current folder. Do not run git commands that write.

## What the pictures are for

A survival game starts every player with nothing. They make stone tools, then a bow, and after some hours of play their first guns, made by hand at a village smithy from forged metal, wood and animal hide: a **revolver**, a **long rifle**, a **double-barrelled shotgun**, and, before any of those, a single-use **flare pistol** carved from wood. These are held in first person at the bottom of the screen closer than anything else in the game, and the player looks down their sights. They are also small pictures in the inventory, 64 pixels a side.

Your pictures are the design. After you, a modeller builds four low-poly 3D meshes straight from your orthographic views, and the materials (already made, or being made now) are laid on them. So the views must be exact enough to model from, consistent enough that the side, top and front views describe one object, and beautiful enough to put on a studio wall.

They are our own design. Do not search the web, and do not look at any pictures of guns from games. Work from this description. In your image prompts describe the guns in your own words and do not name any game, studio or franchise.

## The look

The game's style is readable, chunky low-poly with realistic matte surfaces: forms built from big, clean, flat facets and simple turned shapes you could count, carrying fine natural detail in their surfaces. A little playful, never cartoonish. Think of well-made hand-crafted objects from a frontier gunsmith, slightly exaggerated so they read at a glance.

**What the four share (keep all of these):**

1. Hand-made from forged metal, wood and hide. No plastic, no polymer, no paint, no rails, no modern shapes. Nothing machined to a mirror.
2. Three materials at most on each, from this set: honey-tan **wood** (stocks, grips), dark **steel** (barrels, frames, hammers) with **brass** fittings (bands, a trigger guard), and brown **hide** leather (wraps, a cheek pad). The flare pistol is the exception: wood, plant-fibre **cord** and a **flint** striker, with no metal at all.
3. Chunky. Barrels, cylinders, hammers and triggers about 15 to 20% fatter than a real gun's, so they read in first person and as a small icon. Big simple forms: an octagonal barrel shows its eight flats, a cylinder its flutes.
4. Every gun's sights are on top, on one straight line parallel to the barrel, at the height given below. A player aims down them.

**Our own choices (paint these exactly; they are what make the guns ours):**

- **Revolver:** a five-shot cap-and-ball revolver with a fat cylinder of five chambers, the chamber mouths showing at its front, a long **octagonal** barrel, a big hooked hammer spur, a **folding trigger** that sits flush under the frame with **no trigger guard**, and a curved bird's-head wooden grip. Ours: the grip is **wrapped in a spiral strip of hide** for its middle two-thirds, a **brass band** circles the cylinder's front, and a loading lever lies under the barrel.
- **Long rifle:** a long, slim single-shot rifle, its most striking feature a **long neck**: the wooden fore-stock runs far up under the barrel, more than half the gun's length, with the bare barrel showing beyond it. A bolt with a big round knob on the right side, a simple open rear sight and a blade front sight, a brass trigger guard. Ours: **two brass bands** hold the barrel to the fore-stock, and a **hide cheek pad laced with cord** sits on the left of the butt stock.
- **Shotgun:** a short, fat side-by-side double-barrel with **two exposed hammers**, a rib between the barrels with a brass bead at its muzzle end, a stubby wooden forend, a straight-grip butt stock. Ours: **barrels short and fat** (it is a close-range brute), a **brass band** at the muzzle, the forend **wrapped in hide**.
- **Flare pistol:** a single-use hand-made flare launcher from the stone age of the game: a **fat, stubby, hollow barrel carved from one piece of wood**, its wide bore dark inside, bound with **three rings of fibre cord**; a curved wooden grip; a chunk of **dark flint clamped in a wooden hammer** behind the barrel as the striker; a wooden peg trigger. It looks like a toy cannon a clever survivor made, and is proud of.

## Colours (natural tones, matte)

| Part | Colour |
|---|---|
| Wood | warm honey tan, about #A4784C, darker grain streaks; worn paler and smoother where held, about #B88C5C |
| Steel | dark browned-blued steel, about #404044; worn bright on edges, about #969696 |
| Brass | aged warm brass, about #A8884A |
| Hide | warm mid-dark brown leather, about #7A5638 |
| Cord (flare pistol) | straw tan, about #B09858 |
| Flint (flare pistol) | dark blue-grey-brown, about #4A484C, pale fresh edge about #9C9890 |

## Sizes and axes

Metres. Each gun's **grip point** (the middle of where the shooting hand closes on it) is the origin. The barrel runs along **+Z** toward the muzzle. **+Y** is up: the sights are on top. **+X** is the gun's right side (the side a right-handed shooter's bolt is on). The guns are mirror symmetric across the YZ plane, near enough, except where said.

**Revolver**
- Grip: from its top under the frame at (y = +0.015, z = 0) down and back to its butt at (y = -0.095, z = -0.035), so it rakes back about 20 degrees. About 30 mm thick in x and 38 mm front to back, a little fuller at the bottom where it hooks back into a bird's-head butt. Hide wrap from y = -0.075 to y = 0.000.
- Frame: steel, from z = -0.045 to z = +0.005, behind the cylinder, top at y = +0.058. The hammer's spur rises from it and hooks back, its top at y = +0.082, z = -0.040.
- Cylinder: its axis is the barrel's axis, at **y = +0.040**; from z = +0.005 to z = +0.058, 46 mm across, five flutes between five chambers, the five chamber mouths at its front face. Brass band 8 mm wide round its front.
- Barrel: octagonal, 22 mm across the flats, axis y = +0.040, from z = +0.058 to the muzzle at **z = +0.230**. Loading lever under it, z = +0.075 to +0.190, about y = +0.020.
- Folding trigger: under the frame at z = -0.010, hanging to y = -0.002. No trigger guard.
- **Sights:** a front blade on the barrel top at z = +0.220, its top at **y = +0.062**; a rear notch in the frame's top at z = -0.020, its bottom at **y = +0.062**. The sight line is y = +0.062, parallel to z.

**Long rifle**
- Overall from the butt plate at **z = -0.380** to the muzzle at **z = +0.980**.
- Butt stock: wood, from the butt plate (z = -0.380, 105 mm tall from y = -0.088 to y = +0.017, 40 mm thick) narrowing to the wrist at the grip, which is 36 mm tall and 30 mm thick around the origin. The top line of the stock, its comb, about y = +0.020. A hide cheek pad on the left (-X) side of the butt, z = -0.330 to -0.150, laced with cord.
- Receiver: steel, z = -0.070 to +0.120, top at y = +0.045, 30 mm wide. Bolt knob on the right (+X) side at z = -0.030: a round knob 20 mm across, its centre at x = +0.035, y = +0.030.
- Trigger under the receiver at z = -0.010, in a brass guard hanging to y = -0.045.
- Fore-stock: wood, under the barrel from z = +0.120 to **z = +0.700**, 30 mm thick, its top hugging the barrel's lower half, its bottom tapering from y = -0.030 at z = +0.120 to y = +0.002 at z = +0.700. Brass bands 10 mm wide at z = +0.400 and z = +0.680.
- Barrel: round, 22 mm across, axis at **y = +0.022**, from z = +0.120 to the muzzle at z = +0.980, a little fatter (26 mm) for its last 20 mm at the muzzle.
- **Sights:** an open rear sight at z = +0.200, a notch whose bottom is at **y = +0.052**; a front blade at z = +0.960, its top at **y = +0.052**. The sight line is y = +0.052, parallel to z.

**Shotgun**
- Overall from the butt plate at **z = -0.360** to the muzzles at **z = +0.680**.
- Butt stock: straight grip, wood, the butt plate 110 mm tall (y = -0.090 to +0.020), 40 mm thick, narrowing to a wrist 36 mm tall round the origin.
- Action: steel, z = -0.060 to +0.060, top at y = +0.040, 46 mm wide. Two exposed hammers side by side at x = ±0.013, their spurs rising to y = +0.070 at z = -0.045. Two triggers under it at z = -0.005 and z = +0.012 in a steel guard hanging to y = -0.045.
- Barrels: two, side by side, each **24 mm across**, axes at x = ±0.0125, **y = +0.020**, from z = +0.060 to the muzzles at z = +0.680. A flat rib between them on top, and a brass band 14 mm wide round both at the muzzles.
- Forend: wood, under the barrels from z = +0.080 to z = +0.300, 44 mm wide, its bottom at y = -0.020, wrapped in hide from z = +0.110 to +0.270.
- **Sights:** a brass bead on the rib at z = +0.670, its top at **y = +0.040**; the rib's top at the action's rear edge also at y = +0.040. The sight line is y = +0.040, parallel to z.

**Flare pistol**
- Grip: curved, wood, from (y = +0.015, z = 0) down and back to its butt at (y = -0.090, z = -0.030), 32 mm thick, 40 mm front to back, a knob at the butt.
- Barrel: one piece of wood, round, **56 mm across**, its axis at **y = +0.048**, from z = -0.030 (a rounded breech) to the muzzle at **z = +0.200**, a little flared at the muzzle (62 mm). The bore 36 mm across, dark inside. Three rings of cord round it, each 12 mm wide, at z = +0.010, +0.095 and +0.180.
- Striker: a wooden hammer pivoting behind the barrel at z = -0.045, rising to y = +0.095, with a wedge of dark flint 30 mm long clamped in its jaw, pointing forward and down at the breech.
- Trigger: a wooden peg under the barrel at z = +0.015, hanging to y = -0.005.
- **Sight line:** the top of the barrel, y = +0.076, with a small carved bump as a front sight at z = +0.190, its top at y = +0.084. There is no rear sight; the hammer's top is the rear reference, at about the same height.

## Views to deliver

Every view is a true orthographic projection (no perspective) on a 1254 x 1254 canvas, in flat neutral light: even, soft, frontal, with only gentle form shading; no strong key light, no rim light, no cast or ground shadow, no reflections of an environment. One flat even background, light warm grey RGB (214, 212, 206), the same in every picture. No text anywhere except on check sheets.

For each gun, `<gun>` one of `revolver`, `rifle`, `shotgun`, `flare`:
- `<gun>_side.png`: seen from **+X** (its right side). +Z to image right (muzzle on the right), +Y up the image.
- `<gun>_top.png`: seen from **+Y**, looking down onto the sights. +Z to image right, +X **down** the image.
- `<gun>_front.png`: seen from **+Z**, looking into the muzzle. +X to image **left** (as seen from the front), +Y up.
- A `_mask.png` for each: its silhouette, white on black, the same canvas, matching the colour view exactly.

Scales and origins (column, row of the origin, the grip point):
- **revolver** and **flare**: **3000 pixels per metre**, origin at column 470, row 760 in side and top views; the front view with the barrel axis at column 627, origin row 760.
- **rifle**: **800 pixels per metre**, origin at column 380, row 627 in side and top views; front view at **3000 pixels per metre**, origin at column 627, row 760.
- **shotgun**: **1100 pixels per metre**, origin at column 470, row 627 in side and top views; front view at **3000 pixels per metre**, origin at column 627, row 760.
- `rifle_action_side.png` and `rifle_action_top.png` (with masks): the rifle from z = -0.12 to z = +0.28 at **3000 pixels per metre**, origin at column 380, row 760: the receiver, bolt, trigger and rear sight up close.

**And:**
- `lineup.png`: the four side by side at one scale, side views, on the same background, so their sizes compare. Any layout.
- `hero.png`: the four lying together on a plain neutral surface, seen from above at three quarters, with soft daylight and a soft shadow, showing what they are made of up close. Perspective is fine here.
- `sights.png`: each gun seen exactly along its sight line from behind, as a player aiming it would see it, rear sight in the foreground and the front sight centred in it. Orthographic or a long lens; any scale that shows it.
- `read_sizes.png`: each gun's side view at 128, 64 and 32 pixels across its longest side, and its black silhouette at the same sizes, on one sheet. This is how they must read as inventory pictures. The four must be told apart at 32 pixels.
- `checks/`: your measurements as JSON, and the overlay sheets you made.
- `REPORT.md`: how each picture was made, what you measured, how many rounds, how long it took, what you are not satisfied with. Keep every script in this folder so the work can be rebuilt.

## What must hold

- **The views agree.** For each gun, the side, top and front views describe one object: every length along z in the side view matches the top view within 1% of the gun's length; heights in the side view match the front view and widths in the top view match the front view within 2 mm. Each band, wrap, sight, hammer and lever is the same in every view where it shows. Measure it, draw guide lines across the views side by side and look. If a view disagrees, fix it or make it again; do not stretch a drawing to fit.
- **The sizes hold.** Measure the muzzle, butt, grip, barrel axis and the sights in pixels and convert to metres: within 3% of the numbers above, and **the sights within 1 mm**.
- **Nothing added** beyond what is described: no scope, no sling, no engraving, no text, no maker's marks.

## What excellent looks like

Prop concept art a studio would pin to its wall: four objects you instantly believe a frontier gunsmith made by hand, and that read in one glance even as black shapes 32 pixels across: the revolver a fat cylinder on a long octagon with a hooked grip, the rifle a long thin line with its long wooden neck, the shotgun a short fat double tube with two hammers, the flare pistol a stubby wooden cannon on a grip. Up close, dark oiled steel with bright worn arrises, warm brass bands, honest grained wood worn smooth at the grip, supple hide in tight spiral wraps. Someone who has played survival games should recognise each gun immediately, and on a second look see it is its own design.

Look at every picture you make, compare the views against one another and against this description, and keep going until they agree and you would stand behind them.
