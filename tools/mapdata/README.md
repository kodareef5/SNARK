# Map data tools

A city's base layers, labels, ways and world settings from public sources, by a settings file. They are Miami's tools
(`tools/mapart/fetch.py`, `prepare.py`, `future.py`, `canonical.py`, `round3_bathy.py`, and `blocks/labels.py` in
Miami's folder) with the city taken out of them: every tool takes a map's folder, reads its `city.json` and the
frame `map.json`, and writes what Miami's wrote, where Miami's wrote it. Tampa was the first city made with them and
San Francisco the second; Miami can move onto them once its paintings are no longer the source of its fine layers and
canopy.

```sh
python3.12 -m venv tools/mapdata/.venv                          # any Python 3.12 with OpenSSL; not in git
tools/mapdata/.venv/bin/pip install -r tools/mapart/requirements.txt
bun tools/mapdata/city.ts san-francisco                            # every step below, then the map file
bun tools/mapdata/city.ts san-francisco labels build               # from one step to another
bun tools/mapdata/steep.ts var/maps/san-francisco.snmap 15         # ground past the walkable angle, and the steepest streets and stairs, walked
```

Python 3.9 as macOS ships it is linked to LibreSSL 2.8, which the Overpass servers refuse; Miami's pinned packages
install and give byte-identical layers on 3.12. Run every Python tool with `-I`: the downloads are untrusted.

| Step | Tool | Writes |
| --- | --- | --- |
| frame | `frame.py` | `map.json`: the local Transverse Mercator square round `city.json`'s centre, its corners, grid and coastal model |
| fetch | `fetch.py [tiger dem nlcd fema bathymetry osm]` | `raw/` (ignored), `downloads.json` (request, source, licence line, bytes, SHA-256, time per file), `dem_selection.json`, `blocks/*.overpassql` (`features`: building parts, water, pools, fountains, runways, wheels, with their shapes) |
| prepare | `prepare.py` | `base/` vectors, 2 m layers, land cover, succession (`biome.png`, desert 10 where `dry_classes` lie), drowned streets, lakes above the sea (`perched_water.*`, with OpenStreetMap's water on the ground and each one's kind), an airfield's paving (`paved.geojson`, roads.png 6), `stats.json` |
| attributes | `bun tools/mapworld/fetch-attributes.ts <name>` | `base/buildings_attributes.json`; `city.ts` records the download |
| split | `split.py` | With `footprints.split_by_osm`: USA Structures footprints holding rows of attached buildings cut into OpenStreetMap's outlines, and the buildings it lacks added |
| future | `future.py` | `base/future_changes.geojson`, `bridge_gaps.png` (a span takes every carriageway of its road), `wrecks.png`, tunnels in `roads.png` |
| fine | `fine.py` | `*_fine.png` at 8,192 pixels, endpoint corrections, `painted_canopy*` by rule, `reports/canonical-layers.json` |
| bathymetry | `bathy.py` | `base/bathymetry/<file>.tif` and `source.json` |
| labels | `labels.py` | `blocks/labels.json`, `blocks/places.json`, `blocks/height-units.json` (OpenStreetMap's bare heights read as feet where a city's run near 3.28 times USA Structures') |
| ways | `ways.py` | `blocks/ways.json` (with `bridge:structure`), `blocks/supports.json` (bridge towers mapped in three dimensions), `blocks/stairs.json`, `blocks/signs.json` (lines with an inscription of capitals and a height: letters standing on the ground) |
| world | `world.py [--accept]` | `world/proposed.json`: districts round OpenStreetMap's places and spawn points on named parks; `world/world.json` when there is none or with `--accept` |
| vocabulary | `vocabulary.py` | `ruins/vocabulary.json`, extending `tools/mapworld/rules/default.json`: the city's districts, recipes, label tables and compositions, and budgets scaled to its footprints |
| build | `bun tools/mapworld/build.ts <name>` | `var/maps/<name>.snmap` |

The settings `city.json` holds, beyond the sources: `height_zero_m` (the height height.png's zero stands for, -100 m
unless the ground stands over 555 m), `tiger.counties` (a frame may span counties), `dem.fill` (older lidar projects
used only where the newest has no ground), `footprints.split_by_osm`, `split_cover` and `split_remainder_m2` (a
footprint this large that OpenStreetMap only partly draws is cut into its buildings and the remainder),
`split_taller_first` (where OpenStreetMap's buildings overlap the taller is cut first, each piece is labelled by its
own building alone, and a tower drawn within a larger building takes that host's name), `split_by_parts` (a footprint
whose ground-standing building parts stand a quarter over its known height is cut into them and its podium),
`succession.dry_classes` (NLCD classes that stay desert, not green; the world is then `dryGround`),
`succession.perched_above_sea_m` (2 m) and `flood_below_navd88_m` (null for none), `world` (`sea: false` for a frame
with no sea, `seaNavd88`, `minY`, `report`, `yard_districts`, `container_district`, extra district seeds as `places`,
places to `drop`, `styles`, `spawn_places` with what each faces and, where OpenStreetMap has no point, an `at`,
`easy_around_spawns_m`, and `obelisks`), `ruins` (`rules_from`, `blocks_per_footprint`, and `budgets` over the
reference's) and `future` (spans by road, wrecks by position). A frame with no sea leaves out `bathymetry`. Spawn point
names are held to the 48 bytes the choosing list carries. The named places' compositions are
`ruins/compositions.json` with `ruins/places.json`, written by hand; a place may name its OpenStreetMap building
(`osm_way`, a relation's id negated) and `vocabulary.py` writes the footprint the split cut from it, since split ids move
whenever the split does.

`fetch.py` asks one thing of one server at a time and waits longer after each refusal. The elevation source is
`"kind": "tnm"` (a USGS 3DEP project found through The National Map's product API) or `"kind": "noaa-vrt"` (a NOAA
Digital Coast DEM's VRT index, as Miami's).

Memory: `fine.py` holds about 2.7 GB and the build 6 to 7 GB for San Francisco; run one at a time.
