# San Francisco's base layers

Every layer has Miami's name, size and encoding; [Miami's VALUES.md](../../miami/base/VALUES.md) is the reference
for the sample grid, the conversion to engine x and z, and each file's values. The square is 8,128 m, local
Transverse Mercator on WGS84 centred at 37.7985 N, 122.436 W ([map.json](../map.json)). Made by `tools/mapdata`
from [city.json](../city.json). Where San Francisco's differ:

| File | San Francisco |
|---|---|
| height.png, height_valid.png | From the 2023 USGS lidar (0.25 m cells, NAVD88 metres, bilinear), and where it has no ground, the two 2018 USGS surveys of Marin and the coast. 80.5% of samples have lidar; no land sample lacks it. Ground from -3.2 to 175.0 m NAVD88 |
| water.png, areawater.geojson | TIGER water standing at the sea: 7 of 17 polygons. 38.8% of the square |
| perched_water.png, perched_water.geojson | New. The 10 lakes whose hydro-flattened lidar surface stands more than 2 m over the city's sea (Stow Lake at 87 m, Golden Gate Park's others at 41 to 114 m, Mountain Lake, the small pond by the Palace of Fine Arts): 22,359 samples, left out of the sea because the engine's water is one level. Their surface is the ground, drawn as marsh |
| biome.png | Miami's rule with its heights taken over this city's sea of 0.97 m NAVD88 (6 m and 0.75 m over Miami's 0.3 m become 5.7 m and 0.45 m over the sea), the perched lakes as marsh (5), no sand ribbon |
| flooded_streets.png | Road land below 1.22 m NAVD88 (0.25 m over the sea, as Miami's 0.55 m is over its 0.3 m) within 300 m of the coast: 106 samples. San Francisco stands high |
| buildings.geojson | 44,269 footprints: 5,821 USA Structures footprints as they are, 37,167 OpenStreetMap outlines cut from the 4,817 USA Structures footprints that held rows of them (each with `parent` and `osm_way`), and 1,281 OpenStreetMap buildings USA Structures lacks (`parent` null). Ids of split and added footprints start at 500,000,000 |
| buildings_attributes.json | 10,638 rows from USA Structures as fetched, and a row for each split or added footprint with a `PARENT` field. A piece keeps its parent's height and source; it keeps the parent's occupancy only when that is Residential, Commercial or Industrial, since an institution's class names one tenant of a merged row |
| bridge_gaps.png, wrecks.png, future_changes.geojson | No broken span. Four hulls: a freighter south of Alcatraz, a ferry off Pier 39, a yacht off Marina Green, a tug off Crissy Field. Each has its reason in the file. 3,091 tunnel samples where TIGER names a tunnel (the Robert C. Levy tunnel under Russian Hill among them) |
| painted_canopy*.png | Tampa's rule: crowns on the succession layer's vegetation and open land at Miami's shares, in seeded groves |
| water_fine, buildings_fine, roads_fine | Rasterized from the vectors at 8,192 pixels |
| bathymetry/san-francisco-navd88.tif | NOAA NCEI's San Francisco Bay 1/3 arc-second NAVD88 model, 2010; `bathymetry/source.json` has its request, hashes and depths. Down to -110 m in the Golden Gate |

`stats.json` holds prepare's own numbers; `../reports/canonical-layers.json` the endpoint corrections.
