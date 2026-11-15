You are painting the concept design of two crafting stations for a game. Work only in the current folder. Do not run git commands that write.

## What the pictures are for

A survival game starts every player with nothing. After some hours they smelt their first metal and, much later, build their first machine: a **refining forge** (a furnace that turns ore into metal bars while wood burns in it) and a **fabricator** (a fuel-driven machine that makes the advanced things: electronics, modern guns, armour). A base is judged by which stations stand in it. Players see them from a few metres away, walk up to them, light them or switch them on, and see them as 64-pixel pictures in their inventory. Each has two forms, **out** and **lit** (the forge burning, the fabricator running).

Your pictures are the design. After you, a modeller builds the low-poly 3D meshes straight from your orthographic views, using materials that already exist or are being made (below). So the views must be exact enough to model from, consistent enough that the front, side, top and back views describe one object, and beautiful enough to put on a studio wall.

They are our own design. Do not search the web, and do not look at any pictures of game objects. Work from this description. In your image prompts describe the stations in your own words and do not name any game, studio or franchise.

## The look

Readable, chunky low-poly with realistic matte surfaces: forms built from big, clean, flat facets you could count, carrying fine natural detail in their surfaces. A little playful, never cartoonish: a well-made object, slightly exaggerated so it reads at a glance. Parts about 15% fatter than a real one's. Everything stands square on a flat foot, as it is set down on a floor.

**The materials (paint each surface as one of these, and at most three on a station):**

| Material | What it looks like | Mean colour (sRGB) |
|---|---|---|
| kiln | dark fire-blackened fieldstone set in pale clay; and, as a second kind of surface, smooth fired clay, scorched | stones (80, 74, 68) in clay (150, 124, 98); fired clay (168, 132, 100) |
| boards | honey-tan sawn planks, grain along the plank | (172, 128, 82) |
| plate | painted sheet steel, a muted industrial green-grey paint, chipped to bare steel at edges and corners, grime in the seams; and, as second and third kinds of surface, bare worn bright steel, and a strip of round rivet heads | paint (98, 110, 100), bare steel (150, 150, 148) |
| iron | hand-forged black iron, hammer-dimpled, rust in patches | (44, 41, 39) |
| fire | flat colour only, no texture: for the forge, cold ash grey (96, 92, 88) out, coals orange (238, 120, 30) with a yellow heart (255, 210, 80) lit; for the fabricator's lamps and window, dark smoky glass (58, 62, 64) off, bright amber (255, 186, 70) on | |

The fire material is a flat colour, so a lit form must read by its **shape and colour** in daylight: chunky faceted coals, bright lamp lenses. There is no glow, no light cast on anything around it, no soft flames, no smoke, no sparks.

## The two stations

Each is modelled about the middle of its box. Sizes in metres: **wide** (left to right as seen from the front), **tall**, **deep** (front to back). The **front** is the side a survivor stands at to use it. Nothing may stick out of the box.

**1. Refining forge: 1.20 wide, 1.70 tall, 1.20 deep.** Materials: kiln, boards, fire.
- An eight-sided furnace of stacked dark stones in pale clay, about 1.00 across its flats at the foot, rising straight to about 0.80 and then closing in, like a beehive with flat facets, to about 0.55 across at 1.15. Courses of stone you could count (five or six), big chunky stones, clay between.
- A short square chimney of stones from 1.15 to the top of the box (1.70), about 0.28 across, leaning a little toward the back left, with a flat clay cap.
- An arched mouth low in the front, its sill at 0.20 above the ground, about 0.42 wide and 0.38 tall, framed by a fired-clay lip and a big flat stone lintel, the stone around it more blackened. Inside, a floor of fired clay.
- On top, beside the chimney at the front right, a fired-clay crucible (a thick pot about 0.26 across and 0.20 tall, a pouring spout pointing right) sitting in a clay collar.
- Against the right side, a rack of planks (boards) holding split firewood logs stacked lengthways, about 0.70 tall, filling the box's right edge.
- **Out:** the mouth holds grey ash and a few black lumps (fire material, out); the crucible is empty, its inside dark.
- **Lit:** the same geometry, but the mouth is packed with a chunky heap of faceted glowing coals (orange, a yellow heart) rising to about two thirds of the mouth's height, and the crucible is full to its lip with molten orange (fire material, lit).

**2. Fabricator: 1.70 wide, 1.30 tall, 0.90 deep.** Materials: plate, iron, fire.
- A long, low, squat machine of painted steel panels, riveted (rivet strips along the seams), its body about 1.50 wide and 0.75 deep, standing on four short iron feet, the body's underside at 0.10 above the ground, its top at 1.05. Its front edge chamfered.
- The front: a big square hatch left of middle, about 0.50 by 0.45, with a round window (about 0.26 across) in it and a stout iron handle; right of the hatch a panel of three round gauges in bare-steel rims, a row of chunky knobs under them, and at the right end a big iron lever in a slot, its ball handle up.
- On top: two caged lamps (round lenses about 0.10 across, in iron wire cages) at the front corners, an angled hopper or intake at the back middle, and at the back right an iron exhaust stovepipe rising to the top of the box (1.30) with a little rain cap.
- On the left side, a gasoline jerrycan (painted plate, a bare-steel cap) strapped to the body with an iron strap; it, the lever and the pipe reach the box's edges.
- **Off:** the window and lamp lenses are dark smoky glass (fire material, off).
- **On:** the same geometry, but the lamps' lenses are bright amber and the window shows a bright amber glow (fire material, on); give the lever a second position, thrown down, if that reads better, and say so.

## Views to deliver

Every view is a true orthographic projection (no perspective) on a 1254 x 1254 canvas, in flat neutral light: even, soft, frontal, with only gentle form shading; no strong key light, no rim light, no cast or ground shadow, no reflections. One flat even background, light warm grey RGB (214, 212, 206), the same in every picture. No text anywhere except on check sheets. The middle of the station's box is at the middle of the canvas (column 627, row 627), at **650 pixels per metre** for both.

For each station `<s>` (`forge`, `fabricator`):
- `<s>_front.png`: seen from the front. Up is up, the station's right is image right.
- `<s>_side.png`: seen from its right side. Up is up, the front is at image left.
- `<s>_left.png`: seen from its left side. Up is up, the front is at image right.
- `<s>_top.png`: seen from above. The front is at the bottom of the image, the station's right at image right.
- `<s>_back.png`: seen from behind.
- `<s>_<view>_mask.png` for each of those: the silhouette, white on black, matching the colour view exactly.
- `<s>_hero.png`: a three-quarter view from the front right, from a standing person's eye (1.6 m up, about 3.5 m off), perspective, soft daylight with a soft shadow on a plain neutral ground, showing what it is made of.
- `<s>_front_lit.png` and `<s>_hero_lit.png`: the lit form.

**And:**
- `lineup.png`: the two front views out and lit side by side at one scale, with a plain grey silhouette of a standing person 1.80 m tall beside them, on the same background, so their sizes compare.
- `read_sizes.png`: each station's hero view, out and lit, cut out at 128, 64 and 32 pixels across, and its black silhouette at the same sizes, on one sheet. This is how they must read as inventory pictures.
- `checks/`: your measurements as JSON, and the overlay sheets you made.
- `REPORT.md`: how each picture was made, what you measured, how many rounds, how long it took, what you are not satisfied with. Keep every script in this folder so the work can be rebuilt.

## What must hold

- **The views agree.** For each station the views describe one object: widths agree between front, top and back, depths between the sides and top, heights between front, sides and back, within 1 cm. Each part is the same in every view where it shows. Measure it and draw guide lines across the views side by side. If a view disagrees, fix it or make it again; do not stretch a drawing to fit.
- **The sizes hold.** The box extents above within 1 cm, nothing outside the box; the named parts within 5%.
- **Out and lit are one object**: only the fire material's colour and the parts named as changing differ.
- **At most three materials a station**, from the table, and nothing added beyond what is described.

## What excellent looks like

Prop concept art a studio would pin to its wall: a forge you believe a survivor stacked from the riverbed's stones and clay, and a machine a survivor riveted together from the first steel they made, each reading in one glance even as a black shape 32 pixels across: the forge a squat stone beehive with a chimney and a mouth, the fabricator a long riveted box with a hatch, gauges, lamps and a stovepipe. Up close, blackened stone in pale clay, fired clay, planks with grain, chipped green-grey paint over bright steel, black hammered iron, and coals and lamps that read as hot and lit in plain daylight. Someone who has played survival games should recognise each station immediately, and on a second look see it is its own design.

Look at every picture you make, compare the views against one another and against this description, and keep going until they agree and you would stand behind them.
