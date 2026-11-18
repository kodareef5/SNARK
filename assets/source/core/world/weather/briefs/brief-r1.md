# Weathering masks for the walls of a ruined city: one tileable set of four masks

You are painting the masks a browser game uses to weather the walls of its buildings. The game is a survival game set in Miami decades after people left it: salt, sun and tropical rain have had the city to themselves for a long time. Work only in the current folder. You may write and run scripts (Python with Pillow, numpy and scipy are installed) and use the image generation tool as often as you like.

## Why

The walls are drawn with clean, tileable materials (concrete, painted plaster, brick, steel, timber, glass). Up close they read well, but from four metres out every building is one flat, even tone and the city looks new and empty (`reference-street.png`, `reference-wall.png`, attached: the game today). A ruin's walls tell their story at the scale of a storey: water running off every slab edge and sill, a damp, darker foot with growth, plaster that has let go in patches, the joints of the formwork the concrete was poured in. The game will place that weathering itself, by each wall's own coordinates (metres along the wall, height above the ground and which storey), and colour it by the wall's material. What it needs from you are the shapes: four greyscale masks, at the scale of one bay of one storey.

## The tile

One tile covers **8 m along a wall by 4 m up it**: one structural bay of one storey. Its **top edge is the underside of the slab above** (where water runs off an edge), its **bottom edge is the floor line** of that storey. The game repeats it along every wall and up every storey, and moves and mirrors copies of it from bay to bay and building to building, so nothing in it may be a landmark that reads twice.

Every mask is **2048 pixels wide by 1024 tall** (4 mm a pixel along, 4 mm up), 8-bit greyscale, linear, and **tiles seamlessly left to right**. `damp.png`, `peel.png` and `joints.png` also tile seamlessly top to bottom; `runs.png` does not need to (its top is where the runs start).

1. `runs.png`, runoff: where water running down from the slab edge has washed and stained the wall. 0 none, 255 the heaviest. Streaks hang from the top edge and fade downward: a few clustered drip points per bay where water gathers (2 to 5 heavier runs, 2 to 20 cm wide, some reaching the floor line, most fading out by half way), a fainter veil of many fine runs between them, and a light general wash just under the top edge. Edges wander and break as real streaks do; widths and lengths vary; no comb of evenly spaced lines; nothing perfectly vertical for long. Near the bottom edge the value should be low, so the next storey's top does not show a seam.
2. `damp.png`, a field for rising damp and wet bloom. The game compares it with each pixel's height above the ground to place the top edge of the damp foot, so its **contours become tide lines**: a cloudy field with blobs from 10 cm to about 1 m, smooth inside and with crisp, irregular, slightly salt-rimmed contour detail, so that any threshold of it gives a believable, ragged tide line. Use the full range; a flat histogram is best.
3. `peel.png`, a field for paint and plaster letting go. The game thresholds it: as the threshold falls, more patches open. Patches 2 cm to 80 cm, clustered (a few large losses with smaller satellites around them), with crisp, flaky, irregular edges, never round blobs or noise. High values where paint lets go first. Use the full range; a flat histogram is best.
4. `joints.png`, the marks of the formwork on cast concrete: plywood form panels **2.0 m wide by 2.0 m tall**, so four across the tile and two up (a form joint at the top and bottom edge, which is the pour line at each storey, and one at mid height). Joints are thin lines (1 to 2 cm) with a little broken grout bleed along them, slightly irregular as real formwork is; tie holes (about 2.5 cm across) in a regular grid about 0.6 m apart inside each panel, kept clear of the joints. 0 for no mark, 255 for a joint's core or a tie hole, the bleed in between.

Also deliver `material.json`: `{"metres": [8, 4]}`, and `REPORT.md`: for each file, how it was made, what you checked and saw, and what you are not satisfied with.

## How it will be judged, and how you should judge it first

Make these and look at them yourself before you finish; fix what you see:

- `checks/tiled.png`: each mask tiled 3 across by 3 up (24 m by 12 m), side by side. No seam left to right (and top to bottom for the three that tile so), no landmark found twice, no regular rhythm except the joints' grid.
- `checks/thresholds.png`: `damp.png` and `peel.png` each thresholded at 20%, 40%, 60% and 80%: every one a believable tide line or set of losses.
- `checks/wall.png`: all four applied to a flat, evenly lit pale grey wall three storeys high and three bays wide, at moderate strength: runs as darker grime, the damp foot (lowest 0.8 m, its edge from `damp.png`) darker and a little green, peel as loss to a darker render, joints as fine dark lines. It should read as a weathered concrete and plaster wall from 15 m, and still not repeat.

Bad, and sent back: a seam; a landmark that repeats; a regular comb of runs; round blobs or plain noise for peel; tide lines that are smooth curves; soft, upscaled detail; light, shadow or direction to the light in any mask.

## Outside references

Comparison photographs or scans from outside are fine to look at, but keep them out of the delivered masks and out of this folder's sources, and do not name their authors in the report.
