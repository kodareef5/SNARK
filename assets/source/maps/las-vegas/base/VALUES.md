# Las Vegas's base layers

Every layer has Miami's name, size and encoding but where said here; [Miami's VALUES.md](../../miami/base/VALUES.md) is
the reference for the sample grid, the conversion to engine x and z, and each file's values. The square is 8,128 m,
local Transverse Mercator on WGS84 centred at 36.115 N, 115.172 W ([map.json](../map.json)). Made by `tools/mapdata`
from [city.json](../city.json). Where Las Vegas's differ:

| File | Las Vegas |
|---|---|
| height.png, height_valid.png | From the 2023 USGS lidar (1 ft cells, NAVD88 in US survey feet, bilinear), every sample. Ground from 586.1 to 713.1 m NAVD88. **Centimetres over 500 m** (`height_zero_m`), not Miami's over -100 m |
| water.png, areawater.geojson | Empty: TIGER has no water in the square |
| perched_water.png, perched_water.geojson | 574 of OpenStreetMap's water outlines on the ground, none on a roof, a deck, indoors or an upper level, each with `kind` (pool, fountain, pond, lagoon, basin, stream), `intermittent`, `area_m2` and the surface the lidar gives it: the Fountains of Bellagio at 641.0 m, the Lake of Dreams at 635.5 m, the golf courses' ponds, the resorts' pools. 44,666 samples are burnt; the six mapped intermittent (the Tropicana detention basins and the Flamingo Wash) are listed and not burnt. The build makes them water (`tools/mapworld/lakes.ts`) |
| paved.geojson | New: the airport's runways, taxiways, aprons and helipads from OpenStreetMap, lines buffered by their mapped width or 45 m and 23 m |
| roads.png, roads_fine.png | Value **6** where the airfield is paved and no road runs: the build's `S.PAVED`, asphalt with no street's wrecks |
| biome.png | Miami's rule with **value 10, desert**, where NLCD's barren land or shrub and scrub (`succession.dry_classes`) lies, smoothed as the grown land is: it grows no green. Developed open space (golf courses, parks, medians) is still grown. 1.4% of the square |
| flooded_streets.png | Empty: `flood_below_navd88_m` is null |
| buildings.geojson | 25,802 footprints: 23,969 USA Structures footprints as they are, 1,335 OpenStreetMap outlines and 57 remainders cut from 474 that held several (the taller of overlapping buildings cut first, `host` naming the building a tower stands within), 101 building parts and 47 podiums cut from 28 resorts (`osm_part`, `parts_remainder`), and 293 OpenStreetMap buildings USA Structures lacks. A multipolygon relation's `osm_way` is its id negated. Ids of split and added footprints start at 500,000,000 |
| buildings_attributes.json | 24,453 rows from USA Structures as fetched, and a row for each split or added footprint with a `PARENT` field |
| bridge_gaps.png, wrecks.png, future_changes.geojson | Empty: no bridge crosses water, and no water holds a hull |
| painted_canopy*.png | Tampa's rule at shares of 0.10 of the grown land and 0.02 of the open: almost no canopy |
| bathymetry/ | None |

`stats.json` holds prepare's own numbers; `../reports/canonical-layers.json` the endpoint corrections.
