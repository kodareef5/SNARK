# Round two

I have looked at your masks in your own sheets and in mine. They tile, the histograms are right and the joints are good: keep `joints.png` and `damp.png` as they are. Two masks are not yet right. Fix only those, redo your checks and add a short "Round two" section to REPORT.md.

## Runoff (`runs.png`)

On a wall it reads as a few pencil lines near the top of each storey, then nothing: too few, too thin, too short, and too alike. Water off a slab edge leaves:

- a soft, broad **wash** just under the top edge, 10 to 40 cm deep, uneven along the bay (value about 60 to 120 where it is, fading out downward);
- a **veil** of many faint, fine runs between the heavy ones, reaching half to the whole of the storey, values 20 to 80, widths 3 mm to 3 cm, merging and splitting;
- **3 to 6 heavy runs per bay**, 4 to 30 cm wide, values up to 255 at their heads, several reaching the floor line, with a darker core and a softer, broader halo, slightly wandering and widening where they splash over a ledge, some in pairs or small groups where water gathers;
- no long perfectly vertical line, no even spacing.

Roughly a third of the bay's area should carry some value, most of it low; the heavy runs are what is seen from 15 m. Keep the bottom 5% low so the next storey's top does not show a seam.

## Peel (`peel.png`)

At every threshold it is an even camouflage of small blotches across the whole tile. Paint lets go where water gets behind it, so losses cluster:

- the field should be **low over most of the tile** and high in **two or three areas per tile** (each 0.5 to 2 m across, at different heights, not all at the top), with smaller satellites around each, and only a sparse scatter of small losses elsewhere;
- so that at a 10% threshold only the cores of those areas open, at 30% the areas and their satellites, and at 60% most of the tile;
- edges crisp, irregular and flaky (a paint skin breaking up, with sharp corners and long cracks along the edges), never round blobs or noise.

Keep the histogram flat by how you order the values, not by spreading losses evenly.

## Checks

Redo `checks/tiled.png`, `checks/thresholds.png` (add 10% and 30% for peel) and `checks/wall.png`. Comparison photographs from outside are fine to look at, but keep them out of the delivered masks and this folder's sources, and do not name their authors in the report.
