# A painted map of Miami

You are making the in-game world map for a survival game: the picture a player opens to see where they are. This is the first painted map the project has, and it is the example every later map will be held to. You have a free hand in how you do it. This brief says what it is for, what excellent looks like, what must hold, and what we learned from a first test. It is guidance, not a procedure.

## What it is for

The game is a survival game in the manner of ARK: Survival Evolved, with its own original art. Its maps will be ruined, overgrown cities built from public geographic data. The first is Miami.

The map screen shows a painted picture of the world with a coordinate grid over it (latitude and longitude from 0 to 100, as ARK has), player markers, and coloured cells where bases stand. The game draws the grid, the markers and the cells itself, over your picture. So the picture has to be true to the world: a coast on the map is a coast in the game.

The map has four zooms, baked in advance. Zoom 0 is the whole map in one tile. Each zoom doubles: 2 by 2 tiles, 4 by 4, and 8 by 8 at zoom 3. Every tile is a square picture, 1,024 pixels a side. Each zoom is its own picture drawn for its scale, not a shrunk copy of the one below.

## The example

A square of Miami about 8 km on a side, north up: downtown, the port, Biscayne Bay and its causeways, South Beach. The engine's ground grid is 2 m cells in chunks of 64 m, and the largest map it takes today is 127 chunks, 8,128 m, so make the square exactly that and say where its corners are.

It is Miami long after people: flooded streets, mangrove taking the shore back, towers standing as ruins, causeways broken, the beach wide and wild. Recognisably Miami in its coastline, street pattern and districts.

Painted in the manner of ARK's in-game maps, by description: aged parchment, confident ink linework, watercolour washes, shorelines with a darker ink edge and pale shallows, relief and built-up areas shown with hatching and small drawn symbols. A map an explorer drew. Describe the style to the image tool in words and build our own style sheet; do not give it other games' map pictures.

## The bar

A map someone would frame. Better than our test map, which is the example to beat: `planning/artist-test/map/map_1024.png` and its two double-zoom quarters, with the brief that made them in `planning/artist-test/briefs/map.md` and the report in `planning/artist-test/map/REPORT.md`.

- One hand across all four zooms: the same palette, line weight and symbols, so zooming feels like leaning closer to one drawing.
- Each zoom drawn for its scale. The far zoom broad and bold: the bay, the islands, the districts as shapes. The near zoom rich: individual ruined blocks, causeway spans, mangrove edges, sandbars, wrecks, the grid of streets.
- Detail that rewards looking, and no mush: nothing that reads as filler or noise.
- No lettering, no compass rose, no border and no grid lines in the tiles. The game draws its own grid and labels.

## What must hold

- **True to the data.** Every coast, island, road and built block is where the data puts it, to within a couple of pixels at each zoom.
- **No seams.** Tile joins to tile with nothing to see, across and down, at every zoom.
- **Zooms agree.** A zoom shrunk to the scale of the one above shows the same world in the same colours.

Measure these your own way and report the numbers. They will also be measured independently.

## The data

Public-domain and CC0 sources already identified for Miami:

- The 2021 Miami-Dade LiDAR hosted by NOAA (CC0), with points classified as ground, buildings, vegetation, water and bridges, and the bare-earth elevation raster made from it.
- USGS 3DEP elevation (public domain).
- Census TIGER roads (CC0 in the federal catalogue).
- FEMA USA Structures building outlines.
- USGS NLCD land cover.

Use only sources whose licence lets the result be redistributed freely, and record each one.

Make base layers on the map's own grid (4,065 samples a side at 2 m, or finer if it helps the painting): height, water, land cover, roads, building blocks. These same layers will later become the playable world through the engine's map file, so the painting and the world agree by construction. Keep them as plain files (16-bit PNG for height, 8-bit PNG for classes) with a note saying what each value means.

## What the first test taught

- Work out a style sheet and palette before the big pictures: how sea, shallows, beach, mangrove, swamp, ruin blocks, causeways, roads and height are each drawn. Then every picture is made against it and biomes stay consistent.
- The image tool returns pictures of about 1,254 pixels a side whatever is asked, which suits one tile per picture.
- The image tool alone does not hold a shoreline in place. In the test the painting was warped and composited against the water mask, which made it exact. That worked; better ideas are welcome.
- Give each zoom a reference rendered at that zoom's own resolution. In the test the double-zoom tiles followed an enlarged mask and their shores came out stepped.
- Painting a tile with its neighbours' edges and the zoom above as context kept the hand consistent and the seam invisible.
- Every accepted picture is a reference for the next.

## Where things go

Everything lives in the repository so another team can pick it up and see how it was made.

- `assets/source/maps/miami/`: this brief, `SOURCES.md` (each dataset: address, licence, date, checksum, what was taken), the base layers, the reference renders, the style sheet, every accepted picture, the finished tiles as `tiles/z<zoom>/<column>_<row>.png` with column 0 at the west and row 0 at the north, and `REPORT.md`.
- `assets/source/maps/miami/raw/`: downloads. Keep this folder out of git with a `.gitignore`, since the datasets are large and `SOURCES.md` says how to fetch them again.
- `tools/mapart/`: whatever tools you write, with a short `README.md` saying what each does and how to run it. Python is fine here. The engine and its build have no outside dependencies and that will not change, so keep any packages your tools need in a virtual environment inside `tools/mapart/` that git ignores, and list them with versions. No geodata libraries are installed on this machine; writing a small reader of your own for a format is welcome where practical.
- Touch nothing else in the repository. Do not run git commands that write: your work is committed for you when a run ends.

## How to work

- Work in stages and keep your state on disk: a short `STATE.md` saying what is done, what is accepted and what is next, so that a later run can carry on from it.
- Show something whole early. A good order is the style sheet, zoom 0, zoom 1, then one district carried all the way down to zoom 3, then the rest.
- Look at your pictures. Iterate until you would ship them.
- Several tiles can be worked at once if you can keep the hand consistent.
- Disk is plentiful (about 300 GB free). Network access is on for downloading the data.

## Report

Write `assets/source/maps/miami/REPORT.md` as you go: what you made and how, the sources, your measurements, what you are proud of, what falls short of the bar and why, and how long each stage took. End each run by saying plainly where things stand.
