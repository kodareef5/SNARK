You are painting the concept design of three crafting stations for a game. Work only in the current folder. Do not run git commands that write.

## What the pictures are for

A survival game starts every player with nothing. After the first stone tools they build stations to make better things at, and set them down in their base: a **mortar and pestle** (grinds powders and pastes), a **smithy** (a workbench where metal tools, armour and guns are made) and a **preserving bin** (a smoker that keeps food from spoiling while a little fuel smoulders under it). A base is judged by which of them stand in it. Players see them from a few metres away, walk up to them and open them, and see them as 64-pixel pictures in their inventory.

Your pictures are the design. After you, a modeller builds the three low-poly 3D meshes straight from your orthographic views, using materials that already exist (below). So the views must be exact enough to model from, consistent enough that the front, side and top views describe one object, and beautiful enough to put on a studio wall.

They are our own design. Do not search the web, and do not look at any pictures of game objects. Work from this description. In your image prompts describe the stations in your own words and do not name any game, studio or franchise.

## The look

Readable, chunky low-poly with realistic matte surfaces: forms built from big, clean, flat facets you could count, carrying fine natural detail in their surfaces. A little playful, never cartoonish: a well-made hand-built object, slightly exaggerated so it reads at a glance. Parts about 15% fatter than a real one's. Everything stands square on a flat foot, as it is set down on a floor.

**The materials (already made; paint each surface as one of these, and at most three on a station):**

| Material | What it looks like | Mean colour (sRGB) |
|---|---|---|
| stone | knapped grey stone: big flat flake facets, a paler worn edge where an arris is | (141, 138, 131), edges (168, 164, 156) |
| hide | tanned leather, brown, a little creased | (122, 86, 56) |
| lashing | straw-tan plant-fibre cord, wound | (176, 152, 92) |
| boards | honey-tan sawn planks, grain along the plank, a few nail holes | (172, 128, 82) |
| iron | hand-forged black iron, hammer-dimpled, rust in patches | (44, 41, 39) |
| kiln | dark fire-blackened fieldstone set in pale clay, and smooth fired clay | stone (80, 74, 68), clay (168, 132, 100) |
| fire | flat colour only, no texture: cold ash grey (96, 92, 88) when out; coals orange (238, 120, 30) with a yellow heart (255, 210, 80) when lit | |

The fire material is a flat colour, so in the lit form a fire must read by its **shape and colour** in daylight: chunky faceted coals, a glowing tray. There is no glow, no light cast on anything around it, no flames as soft sprites, no smoke.

## The three stations

Each is modelled about the middle of its box. Sizes in metres: **wide** (left to right as seen from the front), **tall**, **deep** (front to back). The **front** is the side a survivor stands at to use it. Nothing may stick out of the box.

**1. Mortar and pestle: 0.60 wide, 0.50 tall, 0.60 deep.** Materials: stone, hide, lashing.
- A squat eight-sided stone bowl, its rim about 0.54 across, about 0.36 tall, its walls about 6 cm thick at the lip, flat faceted outside, a deep round hollow inside with a grey crust of ground powder in the bottom. A chip knocked out of the lip at front left.
- It stands on three stubby stone feet (about 7 cm tall), so it sits off the ground with a shadow gap under it.
- A band of hide wrapped round its waist, about 8 cm tall, lashed with a fibre cord whose two cut ends hang down at the front.
- The pestle: a fat club of grey stone about 0.38 long, 7 cm across at its grip end swelling to 10 cm at its grinding end, standing in the bowl leaning out toward back right at about 30 degrees from upright, its top end the highest point of the station (exactly at the top of the box, 0.50).

**2. Smithy: 1.60 wide, 1.10 tall, 0.80 deep.** Materials: boards, iron, hide.
- A heavy plank workbench: a top of three or four thick planks, about 1.30 wide and 0.75 deep, its surface at 0.80 above the ground, ends of the planks uneven, one burnt black patch on the top where hot work was laid (painted as a dark scorch on the boards). Four square legs splayed a little outward, joined by a low stretcher on each side; a shelf of planks between the stretchers at about 0.20 holds two or three iron ingots (chunky trapezoid bars).
- At the bench's right end, a big iron anvil on a thick round wooden stump (about 0.40 across) that stands on the ground beside the bench: the anvil's face at 0.95 above the ground, about 0.45 long and 0.14 wide, its horn pointing out to the right, its heel toward the bench, a square hardy hole. The anvil is the tallest thing apart from the tools. The anvil and stump together reach the box's right edge.
- On the bench a hammer (iron head, plank-wood handle) lying, and a pair of iron tongs.
- At the left end, a hide apron hanging from a wooden peg on a short post that rises from the left back leg to the top of the box (1.10), the apron's folds hanging to about the bench top.
- Nothing above 1.10, nothing outside the box.

**3. Preserving bin: 0.80 wide, 1.20 tall, 0.70 deep.** Materials: boards, kiln, fire. A smoker cabinet.
- A firebox at the bottom, 0.30 tall, full width and depth: stacked fire-blackened stones in clay (kiln), with a low arched opening in the front about 0.36 wide and 0.18 tall. Inside the opening a shallow clay tray.
- On it, a cabinet of vertical boards, about 0.72 wide and 0.62 deep, up to 1.00, with dark gaps between the boards (so it reads as slatted), corner posts, and a door taking most of its front, hung on two wooden hinge blocks at its left, with a chunky wooden turn-latch at its right.
- A pitched plank lid from 1.00 to about 1.12, overhanging the cabinet by about 3 cm on each side, and a small square vent stack with a little cap on top, reaching the top of the box (1.20).
- **Out:** the tray holds a heap of cold grey ash (fire material, out).
- **Lit:** the same geometry, but the tray holds a chunky heap of glowing faceted coals of sparkpowder (fire material, lit: orange, a yellow heart), filling the opening's lower half so it reads from across a room.

## Views to deliver

Every view is a true orthographic projection (no perspective) on a 1254 x 1254 canvas, in flat neutral light: even, soft, frontal, with only gentle form shading; no strong key light, no rim light, no cast or ground shadow, no reflections. One flat even background, light warm grey RGB (214, 212, 206), the same in every picture. No text anywhere except on check sheets. The middle of the station's box is at the middle of the canvas (column 627, row 627).

Scales: the mortar at **1600 pixels per metre**; the preserving bin at **850 pixels per metre**; the smithy at **700 pixels per metre**.

For each station `<s>` (`mortar`, `smithy`, `bin`):
- `<s>_front.png`: seen from the front. Up is up, the station's right is image right.
- `<s>_side.png`: seen from its right side. Up is up, the front is at image left.
- `<s>_top.png`: seen from above. The front is at the bottom of the image, the station's right at image right.
- `<s>_back.png`: seen from behind.
- `<s>_mask.png` for each of those: the silhouette, white on black, matching the colour view exactly (e.g. `mortar_front_mask.png`).
- `<s>_hero.png`: a three-quarter view from the front right, from a standing person's eye (1.6 m up, about 3 m off), perspective, soft daylight with a soft shadow on a plain neutral ground, showing what it is made of.
- For the bin also `bin_front_lit.png` and `bin_hero_lit.png`: the lit form.

**And:**
- `lineup.png`: the three front views side by side at one scale (any), with a plain grey silhouette of a standing person 1.80 m tall beside them, on the same background, so their sizes compare.
- `read_sizes.png`: each station's hero view cut out at 128, 64 and 32 pixels across, and its black silhouette at the same sizes, on one sheet (the bin out and lit both). This is how they must read as inventory pictures.
- `checks/`: your measurements as JSON, and the overlay sheets you made.
- `REPORT.md`: how each picture was made, what you measured, how many rounds, how long it took, what you are not satisfied with. Keep every script in this folder so the work can be rebuilt.

## What must hold

- **The views agree.** For each station the front, side, top and back views describe one object: widths agree between front, top and back, depths between side and top, heights between front, side and back, within 1 cm. Each part is the same in every view where it shows. Measure it and draw guide lines across the views side by side. If a view disagrees, fix it or make it again; do not stretch a drawing to fit.
- **The sizes hold.** The box extents above within 1 cm, and nothing outside the box; the named parts within 5%.
- **At most three materials a station**, from the table, and nothing added beyond what is described.

## What excellent looks like

Prop concept art a studio would pin to its wall: three stations you instantly believe a survivor built with their hands, that read in one glance even as black shapes 32 pixels across: the mortar a bowl with a club standing up out of it, the smithy an anvil on a bench, the bin a slatted cabinet on a stone firebox with a little chimney. Up close, faceted knapped stone, wound cord, tanned hide, planks with grain and scorches, black hammered iron, blackened stone in pale clay, coals that read as hot in plain daylight. Someone who has played survival games should recognise each station immediately, and on a second look see it is its own design.

Look at every picture you make, compare the views against one another and against this description, and keep going until they agree and you would stand behind them.
