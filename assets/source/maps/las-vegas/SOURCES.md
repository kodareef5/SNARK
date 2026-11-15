# Las Vegas sources and redistribution

Fetched 2026-11-15 by `tools/mapdata/fetch.py` for the square in [map.json](map.json), whose centre and every source
are named in [city.json](city.json). Each kept file's exact request, licence line, byte count, UTC time and SHA-256 is
in [downloads.json](downloads.json): 291 files, 2,379 MB. Raw files are ignored by git; `bun tools/mapdata/city.ts
las-vegas fetch` fetches them again (`tools/mapdata/README.md`). The elevation tiles (2.33 GB) are not kept; the rest
of `raw/` is, in the main checkout's `assets/source/maps/las-vegas/raw/`.

| Source | Address and licence as its page states it | What was taken |
|---|---|---|
| USGS 3DEP lidar DEM, project NV_ClarkCounty_B22 | [The National Map product API](https://tnmaccess.nationalmap.gov/api/v1/products), tiles from `prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/OPR/Projects/NV_ClarkCounty_B22/NV_ClarkCo_2_B22/`; USGS public domain, access constraints "None.", "Acknowledgement of the USGS 3D Elevation Program would be appreciated in products derived from these data." | 36 Original Product Resolution GeoTIFF tiles, 2,333 MB: 1 ft cells, squares of 5,280 ft, NAD83(2011) / Nevada East and NAVD88 (GEOID18), both in US survey feet (`z_to_m` 0.3048006). Published 2023-06-14: the newest public lidar of the Strip. It covers every sample of the square; the 2016 Las Vegas projects (QL1 and QL2, one tile each in the query) are older and were not needed |
| Census TIGER/Line 2025, Clark County (32003), All Roads and Area Hydrography | [roads](https://www2.census.gov/geo/tiger/TIGER2025/ROADS/tl_2025_32003_roads.zip), [water](https://www2.census.gov/geo/tiger/TIGER2025/AREAWATER/tl_2025_32003_areawater.zip); licence CC0 1.0 on catalog.data.gov, "These products are free to use in a product or publication, however acknowledgement must be given to the U.S. Census Bureau as the source." | 1,751 clipped road lines with MTFCC classes (corridor widths are authored, as Miami's). No water polygon of TIGER's lies in the square |
| FEMA / ORNL USA Structures | [delivery service](https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/USA_Structures_View/FeatureServer/0); CC BY 4.0 on the Esri delivery item, a U.S. government work on the federal catalogue | 24,471 envelope records, 24,453 after clipping; geometry and object id. Then `HEIGHT`, `OCC_CLS`, `PRIM_OCC`, `SEC_OCC`, `OUTBLDG`, `SQMETERS`, `SOURCE`, `VAL_METHOD`, `IMAGE_DATE` for each by `tools/mapworld/fetch-attributes.ts` ([base/buildings_attributes.json](base/buildings_attributes.json)). 474 footprints are split into 1,335 of OpenStreetMap's outlines and 57 remainders, 28 more into 101 building parts and 47 podiums (`tools/mapdata/split.py`) |
| USGS / MRLC NLCD 2021 | [WCS](https://www.mrlc.gov/geoserver/mrlc_display/NLCD_2021_Land_Cover_L48/ows); public domain | One subset of class codes, about 30 m: developed high intensity 59.4%, medium 30.9%, low 5.7%, open space 2.4%, barren 1.2%, shrub 0.3%, grassland 0.1% |
| OpenStreetMap | [Overpass API](https://overpass-api.de/api/interpreter), queries [blocks/osm.overpassql](blocks/osm.overpassql), [blocks/ways.overpassql](blocks/ways.overpassql), [blocks/buildings.overpassql](blocks/buildings.overpassql) and [blocks/features.overpassql](blocks/features.overpassql); © OpenStreetMap contributors, Open Database License 1.0 | Names, kinds, heights and storeys of buildings joined to our footprints ([blocks/labels.json](blocks/labels.json)); 467 positioned places, among them the Welcome to Fabulous Las Vegas sign as a board ([blocks/places.json](blocks/places.json)); 680 bridge and pier ways ([blocks/ways.json](blocks/ways.json)); 345 stairs; every building outline and multipolygon building (94) in the square, which split USA Structures' merged blocks and add 293 buildings it lacks; 359 building parts, which cut 28 resorts into their towers and podiums; 574 water outlines on the ground (546 pools, 29 fountains, ponds, a lagoon, detention basins and a wash: [base/perched_water.geojson](base/perched_water.geojson)); the airport's 4 runways, 252 taxiways, 23 aprons and 40 helipads ([base/paved.geojson](base/paved.geojson)); and the High Roller's plan |

No sea is in the square or within 350 km: heights are NAVD88 as the survey gives them (`world.seaNavd88` 0).

## Attribution to carry with the map

Building footprints: Oak Ridge National Laboratory (ORNL); Federal Emergency Management Agency (FEMA) Geospatial
Response Office, distributed through Esri US Federal Data, CC BY 4.0; clipped, reprojected, split and rasterized for
this map. Building outlines and parts, labels, bridge shapes, stairs, water outlines, the airfield and the sign:
© OpenStreetMap contributors, ODbL 1.0; `base/buildings.geojson` (where split or added), `base/perched_water.geojson`,
`base/paved.geojson`, `blocks/labels.json`, `blocks/places.json`, `blocks/ways.json` and `blocks/stairs.json` are
derived databases under the same licence. Roads: U.S. Census Bureau. Elevation: USGS 3D Elevation Program.

## Sources not used

No coastal model: there is no sea. The 2016 Las Vegas lidar covers parts of the square and is older. No classified
point cloud was taken, so where a resort's towers stand inside its outline is known only where OpenStreetMap draws them
(as buildings or building parts), not measured. Annual NLCD has land cover after 2021; the other cities use the 2021
coverage, so Las Vegas does too.

## What is authored, not observed

The succession layer, the desert's extent and the canopy are the future world, not surveys; [base/VALUES.md](base/VALUES.md)
says how each was made. The district seeds for the Strip's three parts, Naked City, the convention district, the
airport and the Las Vegas Country Club, the district styles, the spawn points' places and what each faces, positions
given where OpenStreetMap has no point, and the obelisks are named in `city.json`'s `world`; the compositions of eight
named places are in `ruins/compositions.json` and `ruins/places.json`.
