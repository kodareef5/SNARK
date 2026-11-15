# Brief: dust, grit and water for small effects

You are painting the shared pictures of a survival game's small effects. When a creature topples over, knocked out or dead, a low ring of dust rolls out from under it along the ground, takes the colour of the ground it fell on, billows a little and is gone in about a second. A creature landing hard kicks up a scuff of dust; one running on sand kicks up a little sand at each step; one pecking at the ground throws up a few grains. One thrown into the sea throws up drops and leaves a ring spreading on the water. Every creature in the game uses these pictures, from a bird the size of a turkey to dinosaurs.

## What excellent looks like

- Dust that reads as dry dust kicked up off the ground: soft, billowing, slightly lumpy, dense at the core and wispy at the edges. Not smoke, not steam, not cotton wool, not a fuzzy ball.
- It holds up seen close (a puff is 0.3 to 0.8 m across, up to 250 pixels on a phone, magnified from the 128 pixels the engine keeps) and far (a few pixels). Several are shown at once, turned and scaled, so each must be roughly round in outline with no straight edge, nothing touching the border, and different enough from the others that a ring of twelve does not look stamped.
- Water drops read as water flying, and the ring as a ripple on still water.

## The pictures

All in this folder, each square, 1024 pixels across (512 at the least), RGBA, transparent all round with the subject centred and at least 6% of the side clear on every edge.

| File | What |
| --- | --- |
| `dust_1.png` to `dust_4.png` | Four puffs of dust, each different in shape and texture |
| `grit.png` | A loose spray of small grains of sand and crumbs of soil, roughly round, densest in the middle |
| `drop.png` | A single drop of water in flight, round, with its highlight |
| `ripple.png` | A ring spreading on still water, seen from straight above: a thin bright ring, soft, nothing inside or outside it |

The colour is near-white light grey, carrying only light and dark: the engine multiplies the dust and grit by the colour of the ground under them, and the water by the light of the sky, so no hue. Light the dust softly from above (a little brighter on top), and paint no cast shadow. Alpha is how much shows: soft throughout the dust, falling to nothing well inside the edge; crisp grains in the grit; the drop solid with a soft rim; the ripple's ring alone.

## What to hand back

- The eight files.
- `preview.png`: the dust and grit multiplied by sand (`#c9b48a`), dry soil (`#8a7356`) and pale stone (`#b5b2aa`), on a darker version of the same ground, at full size, at 128 pixels (the size the engine keeps them at) and at 32; and a ring of twelve puffs as the engine would place them, turned and scaled at random, to judge repetition.
- `REPORT.md`: how you made them, what you checked, and anything you would change.
- Keep any scripts you write in this folder.

Choose your own method. The engine needs only the files and their layout as described; everything else is your judgement, aimed at the best you can make.
