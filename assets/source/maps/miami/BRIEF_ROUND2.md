# Miami, round two

The first round is in this folder and is committed: 85 tiles in four zooms, the base layers, the style sheet, every original painting, the report. Read `BRIEF.md`, `REPORT.md`, `STATE.md`, `style/STYLE.md` and `tools/mapart/README.md`, and look at the tiles before anything else.

## What round one got right, and must keep

- It is true to the data. Coasts, roads and buildings sit where the layers put them.
- No seam shows. Measured independently across all 140 tile joins, the jump across a join is the jump beside it (worst 1.29 times).
- The zooms agree. Each zoom shrunk onto the one above differs by under 2 of 255 in broad colour.
- The nearest zoom has real richness: roofless blocks with rooms, palms and scrub through them, flooded streets, pale shallows.
- Everything is reproducible from the saved originals.

## Why there is a round two

The bar was "a map someone would frame". Round one is an accurate, handsome, tinted plan. It is not yet a drawn map, and the project's owner has asked that work short of the bar be done again, with no limit on time or cost: "aim for the stars". These are the reasons, as seen by someone looking at the pictures, not at the numbers.

1. **The far zooms are not drawn for their scale.** Zoom 0 shows every building and every street of the city at eight metres a pixel. It reads as a street plan seen from far away: a grey-and-tan mesh. An explorer drawing the whole bay would not draw eleven thousand buildings. They would draw the districts as masses with their own character, a handful of landmarks as small pictures (a cluster of ruined towers, the port's sheds and cranes, the broken bridges), bold coasts, and the water. Round one's own report says this: "the exact city fabric is denser at zoom 0 than a freely generalized explorer's atlas would be". At the far zooms, be true to the coast, the islands, the causeways and the main roads, and generalise the rest. The game draws coloured cells for players' bases and markers over the map, so the far zooms need room to breathe.
2. **The shore is a ruled line.** Every coast and island edge is a razor-straight vector edge with one dark line of one weight. It looks like survey output laid under a painting. A drawn coast has a line that thickens and thins, wavers a little, breaks at a beach and doubles at a quay, with shallows that follow it. "Within a couple of pixels" leaves room for a hand.
3. **The story is faint.** This is Miami long after people. At the far zooms the causeways look intact, the streets look dry and the city looks inhabited. The flooded streets, the broken spans, the wrecks and the mangrove taking the shore back should be what the eye finds first at every zoom, drawn for that zoom.
4. **There is no paper.** The style sheet shows ivory rag paper under ink and wash. The tiles are colour from edge to edge. Let the paper show through the washes, most of all on land, and let ink hatching carry relief and density.
5. **The city is one texture.** Downtown towers, low houses, port sheds, parks gone to jungle and beach hotels are all drawn with the same mark. Give each district its own.

## What to do

Paint it again where it falls short, with a free hand as before. Keep what is already at the bar: much of zoom 3 may only need its coasts inked and its districts told apart. Zoom 0 and zoom 1 most likely need a new approach, and zoom 2 some of each. Decide for yourself, by looking.

Before you call it finished, put the whole-map zoom beside the best illustrated maps you know of from any game or atlas and ask which one a stranger would hang on a wall. Keep going until it is this one. Say plainly in the report where it still falls short.

What must hold is unchanged: true to the data at each zoom for what that zoom draws, no seams, zooms that agree in broad colour, tiles of 1,024 pixels named as before, no lettering, border, compass or grid.

## Two practical things

- **The engine counts x the other way.** The repository now has a map file format (`planning/reference/maps.md`, `tools/map.ts`). In it, pictures are north up as the map screen shows them, places are metres from the map's south-east corner, and x grows to the west. Your layers and vectors count easting to the east from the centre. Do not build a map file yet (the format is about to gain a second version), but add to `base/VALUES.md` the exact rule from your coordinates to the engine's, checked against that document, so whoever builds the world cannot get it mirrored.
- **What is kept in the repository** is the artwork and what made it. `assets/source/maps/miami/.gitignore` now leaves out the downloads, the reference renders, the check pictures and the warped copies, since your tools make them again. Keep anything a reader needs to judge the work (measurements, the production log) in `REPORT.md` or beside it, not under `checks/`. Replace round one's tiles and originals in place; history keeps the old ones. Do not run git commands that write: the work is committed for you when the run ends.

Network access is on. The virtual environment under `tools/mapart/.venv` is still there.
