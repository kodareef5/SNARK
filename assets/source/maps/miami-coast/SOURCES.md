# Miami Coast sources and redistribution

Miami Coast is Miami widened: 10,240 m west to east and 16,384 m south to north, from Bear Cut to Surfside's south end,
in Miami's own projection, its south-east corner at lattice column 2016, row 2016 (`map.json`, `city.json`). Inside
Miami's square every base layer, footprint, label, place and way is Miami's own (`tools/mapdata/widen.py`), so
[Miami's sources](../miami/SOURCES.md), with their attribution, hold there. Outside it the layers were made by
`tools/mapdata` from the sources below, fetched 2026-11-18 (UTC) for the whole frame. Exact addresses, byte counts,
UTC times and SHA-256 checksums are in [downloads.json](downloads.json). Raw files are ignored by git;
`tools/mapdata/fetch.py` fetches them again for the frame in `map.json`.

| Source | Address / licence evidence | What was taken |
|---|---|---|
| Census TIGER/Line 2025 Miami-Dade All Roads and Area Hydrography | [Roads](https://www2.census.gov/geo/tiger/TIGER2025/ROADS/tl_2025_12086_roads.zip), [area water](https://www2.census.gov/geo/tiger/TIGER2025/AREAWATER/tl_2025_12086_areawater.zip); **public domain / CC0** (catalog.data.gov) | The two county files, 6.1 MB. Outside Miami's square: 1,234 road pieces and 56 water polygons, cut at its edge. |
| 2021 Miami-Dade ITD LiDAR DEM, NOAA dataset 10339 | [Bulk archive](https://noaa-nos-coastal-lidar-pds.s3.amazonaws.com/dem/FL_Miami_Dade_DEM_2021_10339/index.html), [NOAA InPort 76039](https://www.fisheries.noaa.gov/inport/item/76039), **CC0 1.0** | The VRT index and the 666 2-US-foot bare-earth tiles over the frame, 512 MB. EPSG:6438, NAVD88 US survey feet. |
| FEMA / ORNL USA Structures | [Delivery service](https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/USA_Structures_View/FeatureServer/0) | 33,860 footprints over the frame in 341 requests, 13.1 MB, and the same fields Miami's attributes hold for them (3.6 MB). Outside Miami's square: 21,923 footprints that stand wholly clear of it. |
| USGS / MRLC NLCD 2021 | [WCS](https://www.mrlc.gov/geoserver/mrlc_display/NLCD_2021_Land_Cover_L48/ows); **public domain** | One subset over the frame, 0.47 MB. |
| NOAA NCEI Miami 1/3 arc-second NAVD 88 Coastal DEM | [Dataset](https://www.ncei.noaa.gov/access/metadata/landing-page/bin/iso?id=gov.noaa.ngdc.mgg.dem:5166); not subject to copyright in the United States; not for navigation | One THREDDS subset over the frame with a small margin, 8.5 MB; kept as `base/bathymetry/miami-coast-navd88.tif`. |
| OpenStreetMap through Overpass | **ODbL 1.0**, (c) OpenStreetMap contributors | The pipeline's three queries over the frame (places and buildings' tags, ways, features), 13.4 MB. Outside Miami's square: labels for the new footprints, 405 places, 318 ways and 3 stairs. |

## Building attribution

**Building footprints: Oak Ridge National Laboratory (ORNL); Federal Emergency Management Agency (FEMA) Geospatial
Response Office. Distributed through Esri US Federal Data, CC BY 4.0. Clipped, reprojected, rasterized and
artistically transformed for this map.** [License](https://creativecommons.org/licenses/by/4.0/). Include this file
with redistributed map assets.

## What is authored

Outside Miami's square the future world is made by `tools/mapdata`'s rules, not painted: the succession layer from
NLCD, the lidar and the shore; the canopy by `city.json`'s rule at the shares Miami's paint covers; drowned streets
below 0.55 m NAVD88 within 300 m of the coast; a strip of sand along the ocean side of the barrier island east of
4,200 m. No broken spans or wrecks are authored there. The districts and spawn points there are named in
`world/world.json` from OpenStreetMap's places and `city.json`'s `world`.
