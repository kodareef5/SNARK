# Map data stages

The Python stages of a city's map, run by [tools/maps/city.ts](../maps/README.md) in the city's work folder under
`var/mapdata/`, never in `assets/source/maps`. Each takes that folder, reads its `city.json` (the city's settings
laid over `tools/maps/defaults.json` and `sources.json`) and its `map.json`, and writes what the next stage reads.
Run them through `city.ts`, which knows their order and runs one again only when its inputs or its code change.

Run every Python tool with `-I`: the downloads are untrusted. The venv is `tools/mapdata/.venv`, made from
`tools/maps/requirements.txt` with a Python 3.12 linked to OpenSSL (the Overpass servers refuse LibreSSL).

| Stage | Tool | Writes |
| --- | --- | --- |
| frame | `frame.py` | `map.json`: the local Transverse Mercator rectangle round the centre, its bounds, its corner on the lattice, its corners, grid and coastal model |
| fetch | `fetch.py [tiger dem nlcd fema bathymetry osm]` | `raw/`, `downloads.json` (request, source, licence line, bytes, SHA-256, time per file), `dem_selection.json`, `blocks/*.overpassql` |
| prepare | `prepare.py` | `base/` vectors, 2 m layers, land cover, succession (`biome.png`, desert where `dry_classes` lie), drowned streets, lakes above the sea, an airfield's paving, `stats.json` |
| split | `split.py` | With `footprints.split_by_osm`: USA Structures footprints holding rows of attached buildings cut into OpenStreetMap's outlines, and the buildings it lacks added |
| future | `future.py` | `base/future_changes.geojson`, `bridge_gaps.png` (a span takes every carriageway of its road), `wrecks.png`, tunnels in `roads.png` |
| fine | `fine.py` | `*_fine.png` at about a metre a pixel, endpoint corrections, `painted_canopy*` by the canopy rule |
| bathymetry | `bathy.py` | `base/bathymetry/<file>.tif` and `source.json` |
| labels | `labels.py` | `blocks/labels.json`, `blocks/places.json`, `blocks/height-units.json` (OpenStreetMap's bare heights read as feet where a city's run near 3.28 times USA Structures') |
| ways | `ways.py` | `blocks/ways.json`, `blocks/supports.json`, `blocks/stairs.json`, `blocks/signs.json` |
| world | `world.py --accept` | `world/world.json`: the city's drawn districts and placed spawn points (`world/authored.json`, from its `world.json`), and for the ground they leave, districts round OpenStreetMap's places and spawn points on named parks |
| vocabulary | `vocabulary.py` | `ruins/vocabulary.json`: `tools/maps/rules/tables.json` with the city's `rules.json` over it, its districts' palettes, its compositions, and budgets by its footprints; its named places' footprints found by OpenStreetMap way or by position |

Between `prepare` and `split`, `tools/mapworld/fetch-attributes.ts` asks USA Structures for each footprint's height,
use and source. `steep.ts` walks a built city's steepest streets and stairs.

The settings a stage reads, beyond the sources, are listed where each city sets them: [tools/maps/README.md](../maps/README.md).
`fine.py` holds about 2.7 GB and the build 6 to 7 GB on an 8 km city, about four times that on a 16 km one; run one
city at a time.
