# Los Angeles sources and redistribution

Fetched 2026-11-15 by `tools/mapdata/fetch.py` for the square in [map.json](map.json), whose centre and every source
are named in [city.json](city.json). Each kept file's exact request, licence line, byte count, UTC time and SHA-256 is
in [downloads.json](downloads.json): 569 files, 1,279 MB. Raw files are ignored by git; `bun tools/mapdata/city.ts
los-angeles fetch` fetches them again (`tools/mapdata/README.md`). The elevation tiles (1.16 GB) are not kept; the rest
of `raw/` is, in the main checkout's `assets/source/maps/los-angeles/raw/`.

| Source | Address and licence as its page states it | What was taken |
|---|---|---|
| USGS 3DEP lidar DEM, project CA_LosAngeles_B23 | [The National Map product API](https://tnmaccess.nationalmap.gov/api/v1/products), tiles from `prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/OPR/Projects/CA_LosAngeles_B23/CA_LosAngeles_1_B23/`; USGS public domain, "Acknowledgement of the USGS 3D Elevation Program would be appreciated in products derived from these data." | 90 Original Product Resolution GeoTIFF tiles, 1,158 MB: 0.5 m cells, 1 km squares, NAD83(2011) / UTM zone 11N, NAVD88 metres. Published 2025-06-13: the newest public lidar of Hollywood. It covers every sample of the square, so no older project fills it (the 2018 Los Angeles County lidar, 144 tiles, was not needed) |
| Census TIGER/Line 2025, Los Angeles County (06037), All Roads and Area Hydrography | [roads](https://www2.census.gov/geo/tiger/TIGER2025/ROADS/tl_2025_06037_roads.zip), [water](https://www2.census.gov/geo/tiger/TIGER2025/AREAWATER/tl_2025_06037_areawater.zip); licence CC0 1.0 on catalog.data.gov, "These products are free to use in a product or publication, however acknowledgement must be given to the U.S. Census Bureau as the source." | 1,598 clipped road lines with MTFCC classes (corridor widths are authored, as Miami's) and 10 water polygons, all of them above the sea: the Hollywood Reservoir at 217 m NAVD88, the Los Angeles River's channel and Universal's lake at the north-west edge, and seven ponds (`base/perched_water.geojson`) |
| FEMA / ORNL USA Structures | [delivery service](https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/USA_Structures_View/FeatureServer/0); CC BY 4.0 on the Esri delivery item, a U.S. government work on the federal catalogue | 46,898 envelope records, 46,862 after clipping; geometry and object id. Then `HEIGHT`, `OCC_CLS`, `PRIM_OCC`, `SEC_OCC`, `OUTBLDG`, `SQMETERS`, `SOURCE`, `VAL_METHOD`, `IMAGE_DATE` for each by `tools/mapworld/fetch-attributes.ts` ([base/buildings_attributes.json](base/buildings_attributes.json)). 2,165 footprints are split into 5,496 of OpenStreetMap's outlines and 65 remainders (`tools/mapdata/split.py`) |
| USGS / MRLC NLCD 2021 | [WCS](https://www.mrlc.gov/geoserver/mrlc_display/NLCD_2021_Land_Cover_L48/ows); public domain | One subset of class codes, about 30 m. A fifth of the square is shrub (52): the chaparral of the hills |
| NOAA CO-OPS station 9410840, Santa Monica | [datums](https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/9410840/datums.json?units=metric); NOAA data, public domain | Mean sea level of the 1983-2001 epoch, 0.79 m above NAVD88: the zero of the map's heights (`world.seaNavd88`). No sea is in the square |
| OpenStreetMap | [Overpass API](https://overpass-api.de/api/interpreter), queries [blocks/osm.overpassql](blocks/osm.overpassql), [blocks/ways.overpassql](blocks/ways.overpassql) and [blocks/buildings.overpassql](blocks/buildings.overpassql); the parts of Griffith Observatory and the Hollywood Bowl read once each from the [OpenStreetMap API](https://api.openstreetmap.org/api/0.6/map.json) to place their compositions; © OpenStreetMap contributors, Open Database License 1.0 | Names, kinds, heights and storeys of buildings joined to our footprints by place ([blocks/labels.json](blocks/labels.json)); 543 positioned places; 255 bridge and pier ways ([blocks/ways.json](blocks/ways.json)); 262 stairs ([blocks/stairs.json](blocks/stairs.json)); the Hollywood Sign's nine letters, each a way with its inscription and height ([blocks/signs.json](blocks/signs.json)); every building outline in the square, which split USA Structures' merged blocks and add 3,709 buildings it lacks |

## Attribution to carry with the map

Building footprints: Oak Ridge National Laboratory (ORNL); Federal Emergency Management Agency (FEMA) Geospatial
Response Office, distributed through Esri US Federal Data, CC BY 4.0; clipped, reprojected, split and rasterized for
this map. Building outlines, labels, bridge shapes, stairs and the sign's letters: © OpenStreetMap contributors, ODbL
1.0; `base/buildings.geojson` (where split or added), `blocks/labels.json`, `blocks/places.json`, `blocks/ways.json`,
`blocks/stairs.json` and `blocks/signs.json` are derived databases under the same licence. Roads and water: U.S.
Census Bureau. Elevation: USGS 3D Elevation Program. Sea level: NOAA CO-OPS.

## Sources not used

No coastal model: the square has no sea. The 2018 Los Angeles County lidar (`Los_Angeles_County_Lidar`, 144 tiles)
covers the square too and is older. Annual NLCD has land cover after 2021; the other cities use the 2021 coverage, so
Los Angeles does too. No classified point cloud was taken, so no building or dome height is measured here.

## What is authored, not observed

The succession layer and the canopy are the future world, not surveys; [base/VALUES.md](base/VALUES.md) says how each
was made. The district seeds beyond OpenStreetMap's places (Griffith Park, West Hollywood), the two places left out,
the district styles, the spawn points' places and what each faces, Runyon Canyon's spawn position and the obelisks are
named in `city.json`'s `world`; the compositions of five named places are in `ruins/compositions.json` and
`ruins/places.json`.
