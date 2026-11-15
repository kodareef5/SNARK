# A change of data: every footprint is now labelled

You were stopped on purpose, to hand you better input. Keep what you have built; change what it reads.

The square-by-square survey is stopped at 59 of 598 squares and will not grow. The owner judged it the wrong tool: it described neighbourhoods and guessed which footprint was which. Do not build the generator on it.

In its place, every one of our own footprints is now labelled directly, by joining OpenStreetMap's buildings and USA Structures to our polygons:

- `/home/user/dev/SNARK/.claude/worktrees/miami-blocks/assets/source/maps/miami/blocks/labels.json`: by footprint id (the same ids as `base/buildings.geojson`). For each: `name` and `also` (800 have one), `kind` (81% have one: apartment_block, house, office, hotel, tower_residential, tower_office, tower, government, school, warehouse, theatre, shopping_street, place_of_worship, parking_garage, museum, transit_station, bank, shopping_mall, hospital, university, library, fire_station, police_station, courthouse, city_hall, post_office and a few more), `height_m` (92% have one; `height_from` says whether it is OpenStreetMap's measured figure or the survey's, which runs low for towers), `levels` where tagged, `address`, `use` and `primary_use` from USA Structures, `uses` (what trades inside: shops, restaurants, banks), `area_m2`, and its centre `e`, `n` in metres from the map's centre. Only 346 footprints have neither a kind nor a height.
- `places.json` beside it: 975 named places that are not buildings, each with a kind and a position: 315 bridge pieces, 245 piers, 52 parks, 35 stations, 32 artworks, 27 monuments, 16 islands, 14 cranes, 9 marinas, 7 beaches and more.
- `labels.py` there shows how the join was made, if you need another field from the raw OpenStreetMap answer (`/home/user/dev/SNARK/assets/source/maps/miami/raw/osm/all.json`).

So the generator's first input for a footprint is its own label: a 265 m tower named Panorama Tower, a fire station, a 12 m Deco hotel, a bungalow. Height comes from data, not from a guess. Where a footprint has no kind or no height, settle it from its neighbours, its district and its area, and count how many you settled that way.

The 59 surveyed squares remain at `.../blocks/out/` and may still be read for the lore, style and era of the places they name, matched to footprints by name through `labels.json`. A second, smaller research pass is planned for the named places only (era, style, materials, what its ruin should be known by, lore), keyed by footprint id; leave a clear place for those fields to arrive and do not wait for them.

Everything else in the first brief stands: the owner's direction, the bar, the engine's limits, the seam, the deliverables, and how to work here. In your report, give the counts of what the labels gave you and what you had to settle yourself.
