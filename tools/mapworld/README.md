# Map world tools

Turn a painted map's base layers into a playable map file. Bun and TypeScript,
no dependency; the map file format and its folder of layers are the engine's
(`tools/map.ts`, `planning/reference/maps.md`), and nothing here changes them.

```sh
bun tools/mapworld/build.ts miami                    # base/ to var/maps/miami/layers and var/maps/miami.snmap
bun server/main.ts --dev --map var/maps/miami.snmap --port 8788
bun tools/mapworld/walk.ts var/maps/miami.snmap      # a headless client at every spawn point, walking
bun tools/mapworld/pictures.ts var/maps/miami.snmap <folder> [zoom] [col,row ...]   # the map screen's relief
bun tools/mapworld/views.ts var/maps/miami.snmap assets/source/maps/miami/reports/world1/views.json <folder> medium
bun run snap -- --map var/maps/miami.snmap --graphics medium --pos x,y,z --yaw d --pitch d
bun tools/mapworld/fetch-attributes.ts miami         # once: heights and uses of the footprints (network)
```

The server needs `client/dist` (`bun run build`) as it always does. The map
file is regenerable and lives under `var/`, which git ignores; its inputs are
`assets/source/maps/<name>/base/` and `assets/source/maps/<name>/world/world.json`.

| File | What it does |
| --- | --- |
| `build.ts` | Runs the steps below, writes the folder of layers and the map file, prints the numbers and writes them to `var/maps/<name>/stats.json` |
| `base.ts` | Reads `base/` north up, the elevation model in NAVD88 metres, and the coastal model resampled to the grid |
| `geo.ts`, `tiff.ts` | Transverse Mercator both ways; a reader of single-band float GeoTIFFs (deflate, floating-point predictor) |
| `raster.ts` | Distance fields with nearest sites, regions, box blurs, polygon fill, hashes and value noise |
| `ground.ts` | Heights above the sea: land, beds that wade in from a beach and drop off a seawall, bridges standing or fallen, broken spans, drowned streets, wrecks, the ruins, container rows; and what each sample is |
| `heaps.ts` | The stand-in ruins: a heap per footprint, by surveyed height where there is one. `"heaps": false` in `world.json` leaves each footprint a bare slab |
| `tint.ts` | One palette index a sample, by ground and by the district a ruin stood in |
| `nodes.ts` | Two zoned node layers at 4 m: trees and plants, and stones |
| `places.ts` | Spawn points set on the nearest fit ground to where `world.json` names them, and spawn regions found from the ground |
| `statics.ts` | The slot for layers of static pieces, such as a ruin generator's blocks |
| `walk.ts`, `views.ts`, `pictures.ts` | Proof: the walk, the rasterizer's pictures with the asset files read once, the map screen's relief |

## A layer of statics

A module exports a `StaticLayer` (`statics.ts`): a name and `make(site)`, which
returns pieces `{ kind, x, y, z, yaw }` in engine metres and degrees. The site
holds the world file, the ground as built (heights, what each sample is, the
districts) and every footprint with its rings, area, surveyed height and use,
its district, and what the heaps took it to be, with `toEngine` and `groundAt`.
Add the layer to `STATIC_LAYERS`; the build runs each in order after the
ground and writes their pieces into `statics.json`. Shapes come from hashes of
footprint ids, as the heaps' do, so a rebuild gives the same bytes. Set
`"heaps": false` when the blocks stand.

## Miami ruins

The default Miami build now reads `blocks/labels.json` first. It uses no remote
worktree paths. `labels.ts` imports a replacement join, resolves missing values
from comparable neighbours, and attaches research by an unambiguous name or an
explicit footprint ID. The old square survey supplies no geometry or height.
The build writes its complete label and placement audits to
`assets/source/maps/miami/reports/ruins2/`.

The library is `content/miami-ruins.ts`. Dimensions in `RUIN_SHAPES` are full
metres; the export turns them into half extents. Facade shapes use the listed
finishes, each with a palette index, material and hit points. Structural shapes
share a finish to limit mesh kinds. Add a shape, then use `Mason.put` in a
layout. There is no asset file to export for these box stand-ins.

`assets/source/maps/miami/ruins/vocabulary.json` maps kinds to recipes and gives
district palettes, retention, damage, style, material, era and character rules.
Add a category alias or a recipe there. For new geometry, add a short branch in
`ruin-layouts.ts`, using `tilesOf`, `stack` and `Mason`. A layout must preserve
its stair void and landings, stay in the footprint, and emit whole structures
within the budget. Budget retries reduce detail and playable floors; they do
not delete random pieces after a layout is built.

For a famous place, inspect a reference, find its ID in `blocks/labels.json`,
then add a row in `ruins/places.json`: ID, layout name, recipe, surviving-height
fraction, finish and a sourced note. An optional layout branch composes the
kit. Freedom Tower, the arena, DuPont, the convention hall and SLS are examples.
Panorama reuses the tower recipe; The Loft 2 adds its transit portal. The direct
label height remains the input even when a named rule corrects its use class.
Add future research to `blocks/research.json`; its schema and scope are beside it.

```sh
bun tools/mapworld/build.ts miami
bun test ./tools/mapworld/ruins.test.ts
bun tools/mapworld/ruin-walk.ts --all
bun tools/mapworld/bridge-walk.ts
bun tools/mapworld/access-walk.ts
bun tools/mapworld/walk.ts var/maps/miami.snmap
bun tools/mapworld/server-bench.ts
lockf -t 7200 /tmp/snark-render.lock bun tools/mapworld/views.ts var/maps/miami.snmap assets/source/maps/miami/reports/ruins2/views.json assets/source/maps/miami/reports/ruins2 medium
bun tools/mapworld/ruin-report.ts
lockf -t 3600 /tmp/snark-check.lock bun run check
```

`ruin-walk.ts` drives the real survivor capsule through the packed statics,
including ascending, turning, leaving the last landing and descending. Without
`--all` it selects a reproducible sample plus the named layouts. Flooded starts
are tested too, and reported as failures if a walking controller cannot emerge.
`server-bench.ts` measures a real server host with the core clips and wild
spawner, without a listener or a client. The report distinguishes that from a
live network server.

For a whole city, use `views.ts`: it supplies the actual far-cell stream and
near chunk window to the game scene. The generic `snap` harness lacks that
stream and can overflow its draw list when given the complete city. Each
camera's dropped draw counts are recorded in `rendering.json`.

Open `reports/ruins2/index.html` for the game pictures, side by side references,
category counts by district, all block counts and a searchable named-building
inventory. `generation.json` records every reduced or rejected part, chunk
budgets and a static digest. `labels.json` records all inferred values and the
original neighbour IDs. `places.json` explains each positioned feature's fate;
point-only piers and bridge spans require geometry before a deck can be built.

Round two adds `ways.ts` for clipped bridge and pier paths and water cuts,
`bridges.ts` for connected deck profiles, supports and station stairs, and
`ruin-access.ts` for graded street approaches. Deck elevations are gameplay
settlements, recorded per way, not surveyed elevations. The four authored gap
masks remain authoritative. `bridge-walk.ts` walks every surviving deck run,
climbs station access both ways and swims the recorded water crossings.
`access-walk.ts` walks every emitted street approach in and out with terrain,
statics and vegetation collision. `ruin-walk.ts` also tests the independent
roof drop routes.

Reviewed label changes belong in `blocks/height-corrections.json`, with original
values, replacements, sources and reasons. `labels.py` reapplies that ledger
after the spatial join. `blocks/height-review.json` records the review of all
73 original height/storey conflicts. Do not infer a correction from the ratio
alone. The large generated label, building, bridge and circulation inventories
are ignored; small summaries, comparison pictures and `ruins/REPORT_2.md` are
the reviewable records.
