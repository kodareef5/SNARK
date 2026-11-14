# Miami sources and redistribution

Fetched 2026-11-14. Exact download/query addresses, byte counts, UTC times and SHA-256 checksums are recorded per file in [downloads.json](downloads.json). Raw files are deliberately ignored by git. `tools/mapart/fetch.py` reproduces the acquisition for the frozen square in `map.json`.

| Source | Address / license evidence | What was taken |
|---|---|---|
| 2021 Miami-Dade ITD LiDAR DEM, NOAA dataset 10339 | [Bulk archive](https://noaa-nos-coastal-lidar-pds.s3.amazonaws.com/dem/FL_Miami_Dade_DEM_2021_10339/index.html), [NOAA InPort 76039](https://www.fisheries.noaa.gov/inport/item/76039), explicitly **CC0 1.0** | 369 intersecting 2 US-foot bare-earth GeoTIFFs, VRT index and XML metadata. EPSG:6438 horizontal, NAVD88 US survey feet vertical. Ground height only; no bathymetry. Acquisition 2021. |
| Census TIGER/Line 2025 Miami-Dade All Roads | [County ZIP](https://www2.census.gov/geo/tiger/TIGER2025/ROADS/tl_2025_12086_roads.zip), [federal catalogue license example](https://catalog.data.gov/dataset/tiger-line-shapefile-2024-county-miami-dade-county-fl-all-roads), **public domain / CC0** | 1,184 clipped line features and MTFCC road classes. Corridor widths are authored, not source measurements. Source coordinate system NAD83 geographic. |
| Census TIGER/Line 2025 Miami-Dade Area Hydrography | [County ZIP](https://www2.census.gov/geo/tiger/TIGER2025/AREAWATER/tl_2025_12086_areawater.zip), same federal TIGER public-domain terms | 38 clipped water polygons, including coast, islands, waterways and holes. This is the shoreline authority for this version. |
| FEMA / ORNL USA Structures | [FEMA source hub](https://gis-fema.hub.arcgis.com/pages/usa-structures), [federal catalogue](https://catalog.data.gov/dataset/usa-structures), [delivery service](https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/USA_Structures_View/FeatureServer/0), [delivery item](https://www.arcgis.com/home/item.html?id=0ec8512ad21e4bb987d7e848d14e7e24) | 11,929 bounding-envelope records, 11,919 after exact-square clipping. Geometry and object ID only; no addresses, occupancy or population. Service currency September 13, 2026; acquisition dates vary. |
| USGS / MRLC NLCD 2021 | [WCS](https://www.mrlc.gov/geoserver/mrlc_display/NLCD_2021_Land_Cover_L48/ows), [MRLC data](https://www.mrlc.gov/data), [USGS public-domain data access](https://www.usgs.gov/centers/eros/science/annual-nlcd-data-access) | One geographic subset of class codes from the ~30 m land-cover raster. Nearest-neighbor reprojection, no inference of extra survey resolution. **Public domain.** |

## Building attribution and licensing nuance

The federal catalogue identifies USA Structures as a U.S. government work. The Esri-hosted delivery item additionally declares **CC BY 4.0**. We conservatively retain that attribution rather than labeling this downloaded delivery CC0: **Building footprints: Oak Ridge National Laboratory (ORNL); Federal Emergency Management Agency (FEMA) Geospatial Response Office. Distributed through Esri US Federal Data, CC BY 4.0. Clipped, reprojected, rasterized and artistically transformed for this map.** [License](https://creativecommons.org/licenses/by/4.0/). This permits free redistribution with attribution; include this source file with redistributed map assets. The brief allows freely redistributable sources; this is the one delivery with an attribution obligation.

## Sources not used

The NOAA classified point cloud and USGS 3DEP are candidate sources from the brief, but are not used in this version: the finer NOAA bare-earth DEM already supplies height, FEMA supplies footprint geometry, and NLCD supplies land-cover classes. Do not imply that tree crowns, wall heights, bridge decks or ocean depths have been surveyed in these layers.

## Artwork

Original style sheet and map paint are generated using the built-in image tool from written descriptions and our own geographic reference renders. No other game's map artwork or commercial basemap imagery is an input. Original output files and generation prompts are retained. Authored future-world masks are explicitly separate from public source observations.
