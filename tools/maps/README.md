# Maps v2

A city's map from a small folder of what people wrote. The plan and its reasons: [maps v2](../../planning/workstreams/maps-v2.md).

```sh
bun tools/maps/new-city.ts chicago "Chicago" -87.6298,41.8781   # a city.json round its centre
tools/mapdata/.venv/bin/python -I tools/maps/survey.py assets/source/maps/chicago   # proposes cuts: var/survey/chicago/
# put the cut you choose in city.json's bounds, then:
bun tools/maps/city.ts chicago                   # every stage, then var/maps/chicago.snmap
bun tools/maps/city.ts chicago --from labels     # from one stage on
bun tools/maps/city.ts chicago --only build      # one stage, whether or not its inputs changed
```

The Python steps need `tools/mapdata/.venv` (Python 3.12 with OpenSSL; on Ubuntu `apt install python3.12-venv`):

```sh
python3.12 -m venv tools/mapdata/.venv
tools/mapdata/.venv/bin/pip install -r tools/maps/requirements.txt
```

## A city's folder

`assets/source/maps/<city>/` holds only what people wrote. Everything made from it is in `var/` and never in git.

| File | Holds |
| --- | --- |
| `city.json` | `"v": 2`, `name`, `label`, `centre` (the city's projection, fixed for its life) and `bounds` (the cut: west, south, east and north in metres from the centre, on chunk edges, which fall 32 m off a multiple of 64; up to 255 chunks a side). Then only what differs from [defaults.json](defaults.json) and [sources.json](sources.json): the elevation project (`dem`), the coastal model (`bathymetry`), how footprints are split (`footprints.split_*`), `succession`, `canopy`, `future` (broken spans and wrecks), `world` (spawn places, obelisks, landmarks, the port), `ruins` (budgets) and `height_zero_m` |
| `rules.json` | The city's rule tables over [rules/tables.json](rules/tables.json), key by key: its own recipes, categories, surge (`event`), sight corridors, choices. The rest of the rule library is [tools/mapworld/rules](../mapworld/rules/README.md) |
| `places.json`, `compositions.json` | Named places and the shapes built on them. A place names its building by OpenStreetMap way (`osm_way`, a relation's id negative) or by a point in it (`at`, longitude and latitude), which the build finds again whatever the download or split does; one it cannot find stops the vocabulary stage |
| `heights.json` | Reviewed building heights where the sources are wrong (Aria on the Bay is 163 m, not 8.4): each a `name`, a point in the building (`at`), what to `set` (`height_m`, `levels`, `height_from`), and its `reason` and `sources`. The labels stage sets them; one on no building stops it |
| `world.json` | The districts as drawn (name, style, how tall, a ring of longitudes and latitudes) and the spawn points as placed. The world stage keeps them and proposes districts and spawn points only for the ground they leave, so a bigger cut grows round them |
| `look/` | Cameras and routes for judging the city by eye |
| `art/map.png` | The map screen's picture, once artist has painted it (below) |

Nothing a person writes is kept in a map's own metres or by a source's row number, so a new cut, a re-download or a
new split leaves it where it was: points and areas are longitude and latitude, buildings are OpenStreetMap ways, and
lattice metres (`shared/coords.ts`) are the same for every cut of the city since its centre never moves.

## The work folder

`bun tools/maps/city.ts <city>` lays the city's settings over the defaults and the shared sources, finds the counties
the cut touches (`counties.py`), and works in `var/mapdata/<city>/<cut>/<city>/`, one folder for each centre and bounds,
so a new cut never reads another's downloads. `var/mapdata/<city>/current` is the cut built last. Each stage runs
again only when its inputs, its own code or a stage before it changed (`stages.json`):

| Stage | Tool | Makes |
| --- | --- | --- |
| frame | `tools/mapdata/frame.py` | `map.json`: the projection, the cut, its corners and its place on the lattice |
| fetch | `tools/mapdata/fetch.py` | `raw/`: TIGER, the elevation, NLCD, USA Structures, the coastal model, OpenStreetMap, each in `downloads.json` with its request, licence and SHA-256 |
| prepare | `tools/mapdata/prepare.py` | `base/`: the 2 m layers, the vectors, land cover and succession |
| attributes | `tools/mapworld/fetch-attributes.ts` | `base/buildings_attributes.json` |
| split | `tools/mapdata/split.py` | footprints cut into OpenStreetMap's buildings, where the settings say |
| future | `tools/mapdata/future.py` | broken spans, wrecks, tunnels |
| fine | `tools/mapdata/fine.py` | the fine masks and the canopy |
| bathymetry | `tools/mapdata/bathy.py` | the sea bed |
| labels | `tools/mapdata/labels.py` | `blocks/`: each building's name, kind and height, the named places |
| ways | `tools/mapdata/ways.py` | bridges, piers, towers, stairs, lettered signs |
| world | `tools/mapdata/world.py --accept` | `world/world.json`: districts round OpenStreetMap's places, spawn points, and what `city.json`'s `world` sets |
| vocabulary | `tools/mapdata/vocabulary.py` | `ruins/vocabulary.json`: the rule tables, the city's own over them, budgets by its footprints |
| build | `tools/mapworld/build.ts` | `var/maps/<city>.snmap` |

The downloads are a build's: keep them on a machine that does map work and fetch them again elsewhere. A 16 km cut
holds several gigabytes of them; `du -sh var/mapdata/*` says what each city keeps, and an old cut's folder can go.

## Building a city without its downloads: kits

A machine that works on what the build makes of a city (buildings, furniture, the look) needs the prepared layers, not
the downloads. The machine that holds the downloads packs each city; another unpacks it and builds:

```sh
bun tools/maps/kit.ts pack all                         # var/kits/<city>-<cut>.tar.gz and its .json, 0.2 to 0.4 GB each
bun tools/maps/kit.ts unpack var/kits/miami-<cut>.tar.gz
bun tools/maps/city.ts miami                           # every stage but the build unchanged; the build makes the map
```

A kit is the cut's work folder less `raw/` and `reports/`, with `raw/osm/all.json` kept for the world stage, and the
stages' keys. Keys are inputs and code, never paths, so at the kit's commit every stage but the build is done; an edit
to the build's code (`tools/mapworld`, `tools/map`, the shared world code) builds again from the kit alone. An edit that
reaches a stage reading the downloads (prepare to ways) makes `city.ts` fetch them first. A kit made at another commit
still unpacks: the stages whose code differs run again. Make kits again after a change to a stage before the build.

## Before a city is published: its picture

A map has one painted picture, from the top, as wide and deep as the map and north up, for the map screen (Miami's
85 painted tiles at four zooms retired with v2: the game never loaded them). `bun tools/maps/art.ts <city>` draws the
reference it is painted over, the built map's ground as the game colours it, and a brief for artist into
`var/mapdata/<city>/current/art/`. artist's picture, checked against the reference for coasts and roads, is the one
art file the city keeps: `assets/source/maps/<city>/art/map.png`.

## Adding to it

- A setting every city needs: give it a value in `defaults.json`, read it in the stage, and set it in a city's
  `city.json` only where that city differs.
- A source: once in `sources.json`, fetched in `fetch.py`, recorded in `downloads.json`.
- A rule: in `tools/mapworld/rules/default.json` for every city, or in a city's `rules.json` for one.
- A stage: a line in `STAGES` in `city.ts`, naming the files of code it is, so a change to them runs it again.
