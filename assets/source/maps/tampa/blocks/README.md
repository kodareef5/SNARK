# Tampa's building labels and ways

`labels.json` (by footprint id in `../base/buildings.geojson`) and `places.json` are made by
`tools/mapdata/labels.py` from the OpenStreetMap answer to `osm.overpassql` and USA Structures' attributes, by the
same rules as Miami's `blocks/labels.py`, with positions in the map's own projection. `ways.json` is made by
`tools/mapdata/ways.py` from the answer to `ways.overpassql`. Sources: © OpenStreetMap contributors (ODbL 1.0) and
USA Structures (CC BY 4.0); see `../SOURCES.md`. Labels are joined evidence, not a survey.

Two things in them are known to be wrong and are left as the join gives them (`../REPLICATION.md`):
OpenStreetMap's imported heights run about 7 m above USA Structures' for ordinary houses, and they win; and
footprint 26291430, Raymond James Stadium, is named "Pirate Ship" after a feature inside its bowl, which
`../ruins/places.json` corrects for the ruin. There is no `height-corrections.json` or `research.json` yet.
