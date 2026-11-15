# Los Angeles's base layers

Every layer has Miami's name, size and encoding but one; [Miami's VALUES.md](../../miami/base/VALUES.md) is the
reference for the sample grid, the conversion to engine x and z, and each file's values. The square is 8,128 m, local
Transverse Mercator on WGS84 centred at 34.1055 N, 118.325 W ([map.json](../map.json)). Made by `tools/mapdata` from
[city.json](../city.json). Where Los Angeles's differ:

| File | Los Angeles |
|---|---|
| height.png, height_valid.png | From the 2023 USGS lidar (0.5 m cells, NAVD88 metres, bilinear), every sample. Ground from 47.1 to 554.6 m NAVD88. **Centimetres over 0 m** (`height_zero_m` in map.json), not Miami's over -100 m: the old zero tops out at 555.35 m, 0.76 m over Cahuenga Peak |
| water.png, areawater.geojson | Empty: none of TIGER's ten water polygons stands at the sea, since none is in the square |
| perched_water.png, perched_water.geojson | All ten of TIGER's polygons, 93,680 samples: the Hollywood Reservoir's surface at 217.2 m NAVD88 (216.4 m over the sea), the Los Angeles River's channel at 158 m and Universal's lake at 168 m on the north-west edge, and seven small ponds from 92 to 235 m. Their surface is the ground, drawn as marsh |
| biome.png | Miami's rule with its heights taken over this city's sea of 0.79 m NAVD88; with no sea, nothing is shore, mangrove or drowned. Barren land is beach only within 500 m of the sea, so here none is |
| flooded_streets.png | Empty: `flood_below_navd88_m` is null |
| buildings.geojson | 53,967 footprints: 44,697 USA Structures footprints as they are, 5,496 OpenStreetMap outlines and 65 remainders cut from the 2,165 USA Structures footprints that held rows or blocks of them (each with `parent` and `osm_way`, null for a remainder), and 3,709 OpenStreetMap buildings USA Structures lacks (`parent` null). Ids of split and added footprints start at 500,000,000 |
| buildings_attributes.json | 46,862 rows from USA Structures as fetched, and a row for each split or added footprint with a `PARENT` field, as San Francisco's |
| bridge_gaps.png, wrecks.png, future_changes.geojson | Empty: no bridge crosses water, and no water holds a hull. No tunnel samples |
| painted_canopy*.png | Tampa's rule: crowns on the succession layer's vegetation and open land at Miami's shares, in seeded groves |
| water_fine, buildings_fine, roads_fine | Rasterized from the vectors at 8,192 pixels |
| bathymetry/ | None: the square has no sea and map.json names no coastal model |

`stats.json` holds prepare's own numbers; `../reports/canonical-layers.json` the endpoint corrections.
