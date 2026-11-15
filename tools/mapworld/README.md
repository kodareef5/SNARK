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
