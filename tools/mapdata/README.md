# Map data tools

A city's base layers, labels and ways from public sources, by a settings file. They are Miami's tools
(`tools/mapart/fetch.py`, `prepare.py`, `future.py`, `canonical.py`, `round3_bathy.py`, and `blocks/labels.py` in
Miami's folder) with the city taken out of them: every tool takes a map's folder, reads its `city.json` and the
frame `map.json`, and writes what Miami's wrote, where Miami's wrote it. Tampa was the first city made with them;
Miami can move onto them (its `city.json` would name county 12086, the NOAA 2021 elevation model by its VRT, the
Miami coastal model, the Miami Beach sand ribbon, and its four spans and four wrecks).

```sh
/home/user/.local/bin/python3.12 -m venv tools/mapdata/.venv       # any Python 3.12 with OpenSSL; not in git
tools/mapdata/.venv/bin/pip install -r tools/mapart/requirements.txt
bun tools/mapdata/city.ts tampa                                    # every step below, then the map file
bun tools/mapdata/city.ts tampa labels build                       # from one step to another
```

Python 3.9 as macOS ships it is linked to LibreSSL 2.8, which the Overpass servers refuse; Miami's pinned packages
install and give byte-identical layers on 3.12. Run every Python tool with `-I`: the downloads are untrusted.

| Step | Tool | Writes |
| --- | --- | --- |
| frame | `frame.py` | `map.json`: the local Transverse Mercator square round `city.json`'s centre, its corners and grid |
| fetch | `fetch.py [tiger dem nlcd fema bathymetry osm]` | `raw/` (ignored), `downloads.json` (request, source, licence line, bytes, SHA-256, time per file), `dem_selection.json`, `blocks/*.overpassql` |
| prepare | `prepare.py` | `base/` vectors, 2 m layers, land cover, succession (`biome.png`), drowned streets, `stats.json` |
| attributes | `bun tools/mapworld/fetch-attributes.ts <name>` | `base/buildings_attributes.json` (record it in `downloads.json` by hand; the tool does not) |
| future | `future.py` | `base/future_changes.geojson`, `bridge_gaps.png`, `wrecks.png`, tunnels in `roads.png` |
| fine | `fine.py` | `*_fine.png` at 8,192 pixels, endpoint corrections, `painted_canopy*` by rule, `reports/canonical-layers.json` |
| bathymetry | `bathy.py` | `base/bathymetry/<file>.tif` and `source.json` |
| labels | `labels.py` | `blocks/labels.json`, `blocks/places.json` |
| ways | `ways.py` | `blocks/ways.json` |
| build | `bun tools/mapworld/build.ts <name>` | `var/maps/<name>.snmap` |

`fetch.py` asks one thing of one server at a time and waits longer after each refusal. The elevation source is
`"kind": "tnm"` (a USGS 3DEP project found through The National Map's product API) or `"kind": "noaa-vrt"` (a NOAA
Digital Coast DEM's VRT index, as Miami's). The world build also needs `world/world.json` (districts, spawn points,
sea) and `ruins/vocabulary.json` and `ruins/places.json`, which are written by hand for each city.

Memory: `fine.py` holds about 2.7 GB and the build about 6 GB for Tampa; run one at a time.
