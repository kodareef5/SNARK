# Miami, round three

Round two is merged and is now the example to beat. Read `BRIEF.md`, `BRIEF_ROUND2.md`, `REPORT.md`, `STATE.md`, `style/STYLE.md` and `tools/mapart/README.md`, and look at the tiles of every zoom before anything else.

## What round two got right, and must keep

- The far zooms are drawn for their scale: districts as masses, a handful of landmarks as small pictures, the port with its sheds and cranes, the paper showing through the washes.
- The story reads at first glance on land: skeletal towers, drowned ground, broken spans.
- Zoom 3 is rich, and its water is painted: brush strokes, wave marks, pale shallows that follow the land.
- Measured apart from your own audit: no seam (worst join 1.24 times the jump beside it, over all 140 joins), each zoom against the one above within 1.6 to 2.8 of 255 in broad colour, painted water on the base water at 0.97.
- The rule from your coordinates to the engine's, in `base/VALUES.md`.

## Why there is a round three

The owner's rule has not changed: work short of the bar is done again, with no limit on time or cost, and the bar is a map someone would frame. Three things are short, as seen by someone looking at the pictures.

1. **The far water is not painted.** At zooms 0, 1 and 2 the bay is one flat teal with a soft glow along every shore. More than half of the whole-map picture is water, so more than half of the picture is blank. Your own zoom 3 shows you can paint water. A far zoom should not shrink those strokes; it should chart the bay for its scale, as an explorer would: where it is shallow and where a ship can pass. The real bay has that story (flats and shoals, the dredged cut to the port and its turning basin, the waterway, bars off the beach, the reef line off the ocean shore), and the drowned city adds its own: sunken spans, wrecks, the shoreline that was. No depth data was acquired in the earlier rounds. Public soundings and coastal elevation models exist; if you use one, record its source and licence as you did for the others, and say in the report where depth is drawn from data and where it is invented. The glow at the shore reads as a compositing halo, not as shallows.
   The game draws coloured cells and markers over the map, on water too, so the water must stay calm enough for a marker to read. Calm is not blank.
2. **The small marks repeat.** Your report says it: palms and courtyard ruins share one vocabulary, and at zooms 0 and 1 the landmark pictures are nearly one drawing several times. A survivor finds their way by what is different: give places their own pictures and their own small stories, so that two people can tell each other where they are by describing what is drawn there. Still no lettering.
3. **The mainland's bay shore at zooms 0 and 1** is a stepped, ruled edge with a dashed line. A quay is straight in life, but a hand draws a straight quay with a living line.

## What to do

Paint again where it falls short, with a free hand as before, and leave alone what is at the bar. Decide by looking. Before you call it finished, put the new whole-map zoom beside round two's (git history keeps it; reading history is fine) and ask whether the water half of the picture is now worth looking at, and whether a stranger could name five different places on it.

What must hold is unchanged: true to the data at each zoom for what that zoom draws, no seams, zooms that agree in broad colour, tiles of 1,024 pixels named as before, no lettering, border, compass or grid. Say plainly in the report where it still falls short.

## Practical

Replace tiles and originals in place and update `REPORT.md` and `STATE.md`. Keep what a reader needs to judge the work in `REPORT.md` or under `reports/`, not under `checks/`. Do not run git commands that write: the work is committed for you when the run ends. Network access is on. The virtual environment under `tools/mapart/.venv` is still there.
