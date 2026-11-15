You are painting the concept design of two ranged weapons for a game: a bow and a crossbow. Work only in the current folder. Do not run git commands that write.

## What the pictures are for

A survival game starts every player with nothing. In the first hour they make stone tools, then a **bow** from wood and plant fibre, their first way to fight at range. Later, once they forge metal, a heavier **crossbow**. In first person these sit at the bottom and side of the screen closer than anything else in the game, for hours. They are also small pictures in the inventory, 64 pixels a side.

Your pictures are the design. After you, a modeller builds two low-poly 3D meshes straight from your orthographic views, and the materials (already made, or being made now) are laid on them. So the views must be exact enough to model from, consistent enough that the views describe one object, and beautiful enough to put on a studio wall.

They are our own design. Do not search the web, and do not look at any pictures of weapons from games. Work from this description. In your image prompts describe the weapons in your own words and do not name any game, studio or franchise.

## The look

The game's style is readable, chunky low-poly with realistic matte surfaces: forms built from big, clean, flat facets you could count, carrying fine natural detail in their surfaces. A little playful, never cartoonish. Think of well-made hand-crafted objects, slightly exaggerated so they read at a glance. The game's first tools (a stone pick, hatchet and spear) are already made in this style: a stripped-branch haft of pale honey-tan wood, tan plant-fibre cord wound in thick tight bindings with two loose cut tails, knapped flint. The bow belongs with them.

**The bow (keep all of these):**

1. Made from what a survivor gathers: wood and plant fibre, and the hide of the first animals they hunt. Nothing forged.
2. A **recurve** in the steppe manner: the limbs sweep back from the grip toward the archer, and near each tip the curve reverses into a **stiff straight ear** that points almost straight up (or down), the string hooked over its end. Seen from the side it is a strong, elegant, double-curved line: this profile is how it reads.
3. Chunky: limbs about 20% wider and thicker than a real bow's.
4. Ours: the **grip wrapped in a spiral strip of brown hide**; a **thick binding of tan fibre cord** where each ear joins its limb, with two short cut tails, as on the stone tools; the ears' tips carved into a little **nock knob**; a twisted fibre-cord **string**; a small carved **arrow shelf** bump just above the grip on the left (-Z) side. No feathers, no paint, no metal.

**The crossbow (keep all of these):**

1. A heavy, made-by-hand crossbow: a thick wooden tiller (stock) with a groove along its top, a **steel leaf-spring prod** across its nose, a fibre-cord string drawn back and caught in a nut, a steel trigger.
2. Chunky and blunt: it looks heavier and more powerful than the bow.
3. Ours: the prod is held to the tiller by a **thick figure-eight binding of fibre cord** (the same cord as the bow's and the tools'), with two cut tails; a **steel stirrup loop** at the nose for the foot when cocking; a **wooden pistol grip** under the tiller, raked back; a flared, squared-off butt. No sights, no scope, no bolt loaded.

## Colours (natural tones, matte)

| Part | Colour |
|---|---|
| Wood | warm honey tan, about #A4784C, darker grain streaks; worn paler and smoother where held, about #B88C5C |
| Fibre cord (bindings, strings) | straw tan with a faint green cast, about #B09858, darker in the grooves between turns |
| Hide (bow grip) | warm mid-dark brown leather, about #7A5638 |
| Steel (crossbow prod, stirrup, trigger, nut) | dark browned-blued steel, about #404044; worn bright on edges, about #969696 |

## Sizes and axes

Metres.

**Bow.** Held in the left hand, upright. The **grip point** (the middle of where the hand closes on it) is the origin. The limbs run along **±Y** (+Y up), the arrow flies along **+X**, so the string is behind the grip at -X, toward the archer. **Z** is across the bow: the bow is thin in Z and mirror symmetric across the XY plane, and symmetric top to bottom across the XZ plane, near enough (the arrow shelf is the only exception).
- Grip: from y = -0.075 to y = +0.075, about 30 mm across in z and 40 mm deep in x, its front (+X) face at x = +0.015, its back at x = -0.025. Hide wrap over all of it.
- Limbs: each from the grip's end out to y = ±0.50, sweeping back so that at y = ±0.50 the limb's centreline is at **x = -0.145**. 36 mm wide in z where it leaves the grip, 26 mm at y = ±0.50; 18 mm thick in x, 13 mm at y = ±0.50. Smooth even curve, its steepest near the end.
- Ears: stiff, straight, from y = ±0.50 to the tips at **y = ±0.66**, the curve reversing at y = ±0.50 so the ear points nearly along ±Y; the ear's centreline at the tip at **x = -0.165**. 24 mm wide in z, 20 mm thick in x, ending in a nock knob 30 mm across. A cord binding 40 mm long at each ear's joint (y = ±0.48 to ±0.52), 8 mm thicker all round than the limb.
- String: straight from tip to tip, at **x = -0.172**, 5 mm thick, a twisted cord.
- Arrow shelf: a small rounded bump on the -Z side of the grip's top, at y = +0.075 to +0.095, standing out 10 mm.

**Crossbow.** Held in the right hand like a rifle. The origin is in the tiller just above the pistol grip. The tiller runs along **+Z** toward the nose; **+Y** is up (the groove is on top); **+X** is its right side. Mirror symmetric across the YZ plane, near enough.
- Tiller: wood, from the butt at **z = -0.22** to the nose at **z = +0.46**. Its top, with a groove 8 mm wide and 5 mm deep along its middle, at **y = +0.018**; its bottom at y = -0.040; 40 mm wide in x. The butt flares over its last 0.10 m to 90 mm tall (y = -0.070 to +0.020) and 46 mm wide, its end cut square with rounded corners.
- Pistol grip: wood, under the tiller, from the tiller's bottom at z = 0 down and back to its butt at (y = -0.125, z = -0.030), 30 mm thick in x, 40 mm front to back.
- Trigger: a steel lever under the tiller just in front of the grip, at z = +0.025, hanging to y = -0.075.
- Nut: a steel roller set in the tiller's top at **z = +0.040**, standing 12 mm above the groove, the string caught on it.
- Prod: a steel leaf spring across the nose, its middle at **z = +0.430**, y = +0.005; its tips at **x = ±0.300**, bent back by the drawn string to **z = +0.370**. 38 mm tall in y at the middle, 26 mm at the tips; 13 mm thick in z at the middle, 8 mm at the tips. A small cord loop at each tip for the string.
- Binding: fibre cord, a figure-eight round the prod and the tiller's nose from z = +0.400 to +0.460, 60 mm across, with two cut tails sticking out about 30 mm.
- Stirrup: a steel loop in front of the nose, from z = +0.460 to **z = +0.560**, 90 mm wide in x at its widest, 12 mm thick, in the plane y = +0.005.
- String: fibre cord, 6 mm thick, straight from each prod tip back to the nut: a V seen from above.

## Views to deliver

Every view is a true orthographic projection (no perspective) on a 1254 x 1254 canvas, in flat neutral light: even, soft, frontal, with only gentle form shading; no strong key light, no rim light, no cast or ground shadow, no reflections. One flat even background, light warm grey RGB (214, 212, 206), the same in every picture. No text anywhere except on check sheets.

**Bow**, at **800 pixels per metre**, origin (the grip point) at column 627, row 627:
- `bow_side.png`: seen from **+Z**. +X to image right (arrow flies right, string on the left), +Y up the image. This is its profile: the recurve.
- `bow_back.png`: seen from **-X**, as the archer sees it. +Z to image right, +Y up.
- `bow_top.png`: seen from **+Y**, looking down at the top tip. +X to image right, +Z down the image.
- `bow_grip_side.png` and `bow_grip_back.png`: the grip and the arrow shelf from y = -0.13 to +0.13, at **3000 pixels per metre**, origin at column 627, row 627; the same directions as `bow_side` and `bow_back`.
- `bow_ear_side.png`: the top ear and its binding, from y = +0.42 to +0.68, at **3000 pixels per metre**, seen from +Z, with y = +0.55 at row 627 and x = -0.15 at column 627.

**Crossbow**, at **1500 pixels per metre**, origin at column 380, row 627:
- `crossbow_side.png`: seen from **+X**. +Z to image right (nose on the right), +Y up.
- `crossbow_top.png`: seen from **+Y**. +Z to image right, +X **down** the image.
- `crossbow_front.png`: seen from **+Z**, looking at the nose, origin at column 627, row 627. +X to image **left** (as seen from the front), +Y up.

**And:**
- A `_mask.png` for each view above: its silhouette, white on black, same canvas, matching the colour view exactly.
- `lineup.png`: the two side by side at one scale, their side views, on the same background, so their sizes compare. Any layout.
- `hero.png`: the two lying together on a plain neutral surface, seen from above at three quarters, with soft daylight and a soft shadow, showing what they are made of up close. Perspective is fine here.
- `read_sizes.png`: each one's side view (the bow's profile) and the crossbow's top view at 128, 64 and 32 pixels across its longest side, and their black silhouettes at the same sizes, on one sheet. This is how they must read as inventory pictures.
- `checks/`: your measurements as JSON, and the overlay sheets you made.
- `REPORT.md`: how each picture was made, what you measured, how many rounds, how long it took, what you are not satisfied with. Keep every script in this folder so the work can be rebuilt.

## What must hold

- **The views agree.** For each weapon, the views describe one object: every length in one view matches the others within 1% of the weapon's length, and widths and heights within 2 mm. Each binding, tail, wrap, knob and fitting is the same in every view where it shows. Measure it, draw guide lines across the views side by side and look. If a view disagrees, fix it or make it again; do not stretch a drawing to fit.
- **The sizes hold.** Measure the tips, the string, the grip, the prod, the nut, the butt and the nose in pixels and convert to metres: within 3% of the numbers above.
- **Nothing added** beyond what is described.

## What excellent looks like

Prop concept art a studio would pin to its wall: two objects you instantly believe someone made by hand, and that read in one glance even as black shapes 32 pixels across: the bow a tall double-curved line with its string, the crossbow a heavy T of tiller and prod with its V of string. Up close, honest grained wood worn smooth at the grip, tight twisted cord, supple hide in a spiral wrap, dark oiled steel with bright worn edges. Someone who has played survival games should recognise each immediately, and on a second look see it is its own design.

Look at every picture you make, compare the views against one another and against this description, and keep going until they agree and you would stand behind them.
