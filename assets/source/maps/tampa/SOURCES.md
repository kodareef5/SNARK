# Tampa sources and redistribution

Fetched 2026-11-15 by `tools/mapdata/fetch.py` for the square in [map.json](map.json), whose centre and every
source are named in [city.json](city.json). Each kept file's exact request, licence line, byte count, UTC time and
SHA-256 is in [downloads.json](downloads.json): 369 files, 584 MB. Raw files are ignored by git;
`bun tools/mapdata/city.ts tampa fetch` fetches them again (`tools/mapdata/README.md`).

| Source | Address and licence as its page states it | What was taken |
|---|---|---|
| USGS 3DEP lidar DEM, project FL_HillsboroughPinellas_B24 | [The National Map product API](https://tnmaccess.nationalmap.gov/api/v1/products), tiles from `prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/OPR/Projects/FL_HillsboroughPinellas_B24/`; metadata: access constraints "None", "Acknowledgement of the USGS 3D Elevation Program would be appreciated in products derived from these data." USGS public domain | 42 Original Product Resolution GeoTIFF tiles, 548 MB: 2.5 US-foot cells, 5,000 ft squares, NAD83(2011) Florida West (ftUS), NAVD88 (GEOID18) in US survey feet. Flown 2025-01-08 to 2025-01-30, published 2026-11-02: the newest public lidar of Hillsborough County. Hydro-flattened, so it covers the water too |
| Census TIGER/Line 2025, Hillsborough County, FL, All Roads and Area Hydrography | [roads ZIP](https://www2.census.gov/geo/tiger/TIGER2025/ROADS/tl_2025_12057_roads.zip), [water ZIP](https://www2.census.gov/geo/tiger/TIGER2025/AREAWATER/tl_2025_12057_areawater.zip); [catalog.data.gov](https://catalog.data.gov/dataset/tiger-line-shapefile-2024-county-hillsborough-county-fl-all-roads): licence CC0 1.0, "These products are free to use in a product or publication, however acknowledgement must be given to the U.S. Census Bureau as the source." | 1,592 clipped road lines with MTFCC classes (corridor widths are authored, as Miami's) and 69 water polygons, the shoreline authority |
| FEMA / ORNL USA Structures | [delivery service](https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/USA_Structures_View/FeatureServer/0); CC BY 4.0 on the Esri delivery item, a U.S. government work on the federal catalogue | 31,698 envelope records, 31,688 after clipping to the square; geometry and object id. Then `HEIGHT`, `OCC_CLS`, `PRIM_OCC`, `SEC_OCC`, `OUTBLDG`, `SQMETERS`, `SOURCE`, `VAL_METHOD`, `IMAGE_DATE` for every one by `tools/mapworld/fetch-attributes.ts` ([base/buildings_attributes.json](base/buildings_attributes.json)); no address, place or population field |
| USGS / MRLC NLCD 2021 | [WCS](https://www.mrlc.gov/geoserver/mrlc_display/NLCD_2021_Land_Cover_L48/ows); public domain | One subset of class codes, about 30 m |
| NOAA NCEI Tampa Bay, Florida 1/3 arc-second NAVD 88 Coastal DEM | [THREDDS subset](https://www.ngdc.noaa.gov/thredds/ncss/grid/regional/tampa_bay_13_navd88_2014.nc), metadata [gov.noaa.ngdc.mgg.dem:5163](https://data.noaa.gov/waf/NOAA/NESDIS/NGDC/MGG/DEM/iso/xml/5163.xml): "Produced by the NOAA National Centers for Environmental Information. Not subject to copyright protection within the United States." catalog.data.gov: CC0 1.0. "Not to be used for navigation." | A 1,016 × 919 subset at 1/3 arc-second, issued 2014-09-11, kept losslessly as [base/bathymetry/tampa-navd88.tif](base/bathymetry/source.json): the bay's bed under the TIGER water |
| OpenStreetMap | [Overpass API](https://overpass-api.de/api/interpreter), queries [blocks/osm.overpassql](blocks/osm.overpassql) and [blocks/ways.overpassql](blocks/ways.overpassql); © OpenStreetMap contributors, Open Database License 1.0 | Names, kinds, heights and storeys of buildings joined to our footprints by place ([blocks/labels.json](blocks/labels.json)), 877 positioned places, and 680 bridge, viaduct, pier and breakwater ways ([blocks/ways.json](blocks/ways.json)) |

## Attribution to carry with the map

Building footprints: Oak Ridge National Laboratory (ORNL); Federal Emergency Management Agency (FEMA) Geospatial
Response Office, distributed through Esri US Federal Data, CC BY 4.0; clipped, reprojected, rasterized and
transformed for this map. Labels and bridge shapes: © OpenStreetMap contributors, ODbL 1.0; `blocks/labels.json`,
`blocks/places.json` and `blocks/ways.json` are derived databases under the same licence. Roads and water: U.S.
Census Bureau. Elevation: USGS 3D Elevation Program. Bay bed: NOAA NCEI.

## Sources not used

NOAA's Hillsborough County 2017 DEM (dataset 9457, a single 15.25 GB GeoTIFF) is older than the 2025 USGS lidar.
NOAA's Tampa Bay 2019 topobathy lidar (9278) and USF's 2022 Tampa Bay bathymetry (9856) are newer than the NCEI model
and finer, but only the NCEI model is the same kind of source as Miami's bay bed; they are the first place to look
if the channels need more truth. No classified point cloud was taken, so no building or bridge deck height is
measured here.

## What is authored, not observed

The succession layer, drowned streets, three broken spans, three wrecks and the canopy are the future world, not
surveys; [base/VALUES.md](base/VALUES.md) says how each was made. The district rectangles, spawn points and ruin
vocabulary in `world/` and `ruins/` were written by hand.
