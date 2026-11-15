# Tampa's base layers

Every layer has Miami's name, size and encoding; [Miami's VALUES.md](../../miami/base/VALUES.md) is the reference
for the sample grid, the conversion to engine x and z, and each file's values. The square is 8,128 m, local
Transverse Mercator on WGS84 centred at 27.9445 N, 82.469 W ([map.json](../map.json)). Made by `tools/mapdata`
from [city.json](../city.json). Where Tampa's differ:

| File | Tampa |
|---|---|
| height.png, height_valid.png | From the 2025 USGS lidar, US survey feet to metres by 1200/3937, bilinear. The lidar is hydro-flattened, so every sample is valid, the water included: 100% against Miami's 71%. The world build takes water heights from the coastal model, as for Miami |
| biome.png | Miami's rule, without the Miami Beach sand ribbon (`succession.sand_ribbon` is null): bare sand only where NLCD says 31. 18,677 sand samples against Miami's 238,570 |
| flooded_streets.png | Miami's rule (road land below 0.55 m NAVD88 within 300 m of the coast): 625 samples against Miami's 21,476; Tampa stands higher |
| bridge_gaps.png, wrecks.png, future_changes.geojson | Made the same way as Miami's, by hand, but from `city.json` rather than code: three spans (Davis Islands Bridge, the Selmon Expressway over the river mouth, Harbour Island Boulevard) and three hulls (a tender in the Ybor Channel, a freighter between Davis Islands and Hookers Point, a yacht off Bayshore). Each has its reason in the file. No tunnel in the square |
| painted_canopy*.png | Made by a rule, not traced: Tampa has no paintings. Crowns on the succession layer's vegetation (classes 3 to 5) and open land (class 2) at the shares Miami's paint covers them, 59% and 15%, in groves of a seeded smooth field, never on water, roads, footprints or sand. `painted_canopy.json` records the rule |
| water_fine, buildings_fine, roads_fine | Rasterized from the vectors at 8,192 pixels (Miami's came from its z3 references, the same thing) |
| bathymetry/tampa-navd88.tif | NOAA NCEI's Tampa Bay 1/3 arc-second NAVD88 model, 2014; `bathymetry/source.json` has its request, hashes and depths. 6.8% of TIGER water has a non-negative model elevation (Miami: 2.1%) |
| buildings_attributes.json | 31,688 rows. Residential heights are low (median 3.7 m) beside OpenStreetMap's (median 10.9 m); see `../REPLICATION.md` |

`stats.json` holds prepare's own numbers; `../reports/canonical-layers.json` the endpoint corrections.
