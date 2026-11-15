# San Francisco sources and redistribution

Fetched 2026-11-15 by `tools/mapdata/fetch.py` for the square in [map.json](map.json), whose centre and every
source are named in [city.json](city.json). Each kept file's exact request, licence line, byte count, UTC time and
SHA-256 is in [downloads.json](downloads.json): 436 files, 2,654 MB. Raw files are ignored by git;
`bun tools/mapdata/city.ts san-francisco fetch` fetches them again (`tools/mapdata/README.md`). The elevation tiles
(2.6 GB) are not kept; the rest of `raw/` is, in the main checkout's `assets/source/maps/san-francisco/raw/`.

| Source | Address and licence as its page states it | What was taken |
|---|---|---|
| USGS 3DEP lidar DEM, project CA_SanFrancisco_B23 | [The National Map product API](https://tnmaccess.nationalmap.gov/api/v1/products), tiles from `prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/OPR/Projects/CA_SanFrancisco_B23/CA_SanFrancisco_1_B23/`; USGS public domain, "Acknowledgement of the USGS 3D Elevation Program would be appreciated in products derived from these data." | 228 Original Product Resolution GeoTIFF tiles, 2,389 MB: 0.25 m cells, 500 m squares, NAD83(2011) / San Francisco CS13 (EPSG 7131), NAVD88 (GEOID18) metres. Published 2024-08-21: the newest public lidar of San Francisco. It stops at the county line |
| USGS 3DEP lidar DEMs, CA_NoCal_Wildfires_B5b_QL1_2018 and CA_NoCAL_Wildfires_B5b_2018 | The same API and terms | 10 tiles (45 MB, 0.5 m) and 79 tiles (140 MB, 1 m), Conus Albers metres, published 2020. Used only where the 2023 survey has no ground: Marin's corner north of the strait and a strip down the west coast (`dem.fill` in city.json) |
| Census TIGER/Line 2025, San Francisco County (06075) and Marin County (06041), All Roads and Area Hydrography | [roads 06075](https://www2.census.gov/geo/tiger/TIGER2025/ROADS/tl_2025_06075_roads.zip), [roads 06041](https://www2.census.gov/geo/tiger/TIGER2025/ROADS/tl_2025_06041_roads.zip), [water 06075](https://www2.census.gov/geo/tiger/TIGER2025/AREAWATER/tl_2025_06075_areawater.zip), [water 06041](https://www2.census.gov/geo/tiger/TIGER2025/AREAWATER/tl_2025_06041_areawater.zip); licence CC0 1.0 on catalog.data.gov, "These products are free to use in a product or publication, however acknowledgement must be given to the U.S. Census Bureau as the source." | 1,614 clipped road lines with MTFCC classes (corridor widths are authored, as Miami's) and 17 water polygons, of which 7 are the sea and 10 are lakes above it (`base/perched_water.geojson`) |
| FEMA / ORNL USA Structures | [delivery service](https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/USA_Structures_View/FeatureServer/0); CC BY 4.0 on the Esri delivery item, a U.S. government work on the federal catalogue | 10,641 envelope records, 10,638 after clipping; geometry and object id. Then `HEIGHT`, `OCC_CLS`, `PRIM_OCC`, `SEC_OCC`, `OUTBLDG`, `SQMETERS`, `SOURCE`, `VAL_METHOD`, `IMAGE_DATE` for each by `tools/mapworld/fetch-attributes.ts` ([base/buildings_attributes.json](base/buildings_attributes.json)). 4,817 footprints that hold rows of attached buildings are split into 37,167 of OpenStreetMap's outlines (`tools/mapdata/split.py`) |
| USGS / MRLC NLCD 2021 | [WCS](https://www.mrlc.gov/geoserver/mrlc_display/NLCD_2021_Land_Cover_L48/ows); public domain | One subset of class codes, about 30 m |
| NOAA NCEI San Francisco Bay, California 1/3 arc-second NAVD 88 Coastal DEM | [THREDDS subset](https://www.ngdc.noaa.gov/thredds/ncss/grid/regional/san_francisco_13_navd88_2010.nc), metadata [gov.noaa.ngdc.mgg.dem:741](https://data.noaa.gov/waf/NOAA/NESDIS/NGDC/MGG/DEM/iso/xml/741.xml): "Produced by the NOAA National Centers for Environmental Information. Not subject to copyright protection within the United States." "Not to be used for navigation." | A 1,124 × 919 subset at 1/3 arc-second, 2010, kept losslessly as [base/bathymetry/san-francisco-navd88.tif](base/bathymetry/source.json): the bed under the TIGER water, 110 m deep under the Golden Gate |
| NOAA CO-OPS station 9414290, San Francisco | [datums](https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/9414290/datums.json?units=metric); NOAA data, public domain | Mean sea level of the 1983-2001 epoch, 0.97 m above NAVD88: the city's sea (`world.seaNavd88`) |
| OpenStreetMap | [Overpass API](https://overpass-api.de/api/interpreter), queries [blocks/osm.overpassql](blocks/osm.overpassql), [blocks/ways.overpassql](blocks/ways.overpassql) and [blocks/buildings.overpassql](blocks/buildings.overpassql); © OpenStreetMap contributors, Open Database License 1.0 | Names, kinds, heights and storeys of buildings joined to our footprints by place ([blocks/labels.json](blocks/labels.json)); 2,009 positioned places; 1,318 bridge, pier and breakwater ways ([blocks/ways.json](blocks/ways.json)); the Golden Gate's 36 tower parts mapped in three dimensions ([blocks/supports.json](blocks/supports.json)); 1,414 stairs ([blocks/stairs.json](blocks/stairs.json)); every building outline in the square, which split USA Structures' merged rows and add 1,281 buildings it lacks |

## Attribution to carry with the map

Building footprints: Oak Ridge National Laboratory (ORNL); Federal Emergency Management Agency (FEMA) Geospatial
Response Office, distributed through Esri US Federal Data, CC BY 4.0; clipped, reprojected, split and rasterized for
this map. Building outlines, labels, bridge shapes and towers, stairs: © OpenStreetMap contributors, ODbL 1.0;
`base/buildings.geojson` (where split or added), `blocks/labels.json`, `blocks/places.json`, `blocks/ways.json`,
`blocks/supports.json` and `blocks/stairs.json` are derived databases under the same licence. Roads and water: U.S.
Census Bureau. Elevation: USGS 3D Elevation Program. Bay bed: NOAA NCEI. Sea level: NOAA CO-OPS.

## Sources not used

NCEI's `san_francisco_bay_P090_2018.nc` is newer than the 2010 model, but its dataset description names no vertical
datum; the 2010 model is NAVD 88, as Miami's and Tampa's are. Annual NLCD has land cover after 2021; Miami and Tampa
use the 2021 coverage, so San Francisco does too. No classified point cloud was taken, so no building or deck height is
measured here; the Golden Gate's towers come from OpenStreetMap's mapped parts.

## What is authored, not observed

The succession layer, drowned streets, four wrecks and the canopy are the future world, not surveys;
[base/VALUES.md](base/VALUES.md) says how each was made. No bridge span is broken. The district seeds beyond
OpenStreetMap's places (the Presidio), two district styles, the spawn points' places and what each faces are named in
`city.json`'s `world`; the compositions of six named places are in `ruins/compositions.json` and `ruins/places.json`.
