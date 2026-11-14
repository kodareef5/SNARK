# Bathymetry added in round three

`miami-navd88.tif` is a lossless Float32 single-band geographic subset of NOAA's
2015 Miami 1/3 arc-second NAVD88 coastal elevation model. Values are elevations
in metres, including positive land values. Nodata is −99999. Horizontal datum
is WGS84 (EPSG:4326); the GeoTIFF contains its transform. This is not an engine
vertex grid and does not replace height.png.

There are 995 columns and 909 rows at 1/10800 degree spacing. Pixel-centre bounds
are west −80.21203704258, east −80.12000000812, south 25.73796296470, north
25.82203703642, from the downloaded coordinate arrays. Stale regional bounding
attributes were discarded. No vertical datum conversion was performed. See
[source, licence and hashes](../../reports/round3/bathymetry-source.json) and
[SOURCES.md](../../SOURCES.md).

`round3_bathy.py` reprojects this retained data independently at each native
artwork resolution, bilinearly. Pigment uses max(−elevation, 0), a relative-depth
convention below NAVD88, not a claim about present or future sea surface.
At overview resolution, 2.145% of TIGER surface-water pixels have nonnegative
source elevations, reflecting source dates, datum and coast differences. Those
receive the shallowest pigment category. The TIFF preserves their original
values; no invented elevations are written into it. TIGER remains the coast
authority. Its land/water polygons are not moved to match this older DEM.

Depth influences broad wash. Independent strokes and a shared colour correction
make delivered RGB unsuitable for recovering depth. The public model supplies
large underwater forms; fine current marks and all post-human stories are
artistic interpretation.
