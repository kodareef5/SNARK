# Shared world layers

Base PNGs without the `_fine` suffix are 4,065 × 4,065 **vertex samples**, with north at row 0. The inclusive endpoints span exactly 8,128 m: sample `(column,row)` is `(−4064 + 2×column, 4064 − 2×row)` metres in the local Transverse Mercator CRS in `../map.json`. There are 4,064 two-metre cells, 127 chunks of 64 m. Read grayscale values as numbers, with no color management or gamma conversion. The PNGs contain no georeferencing tags; `map.json` and this file are authoritative.

The game tile images instead use pixel areas: at zoom z, pixel centers are `(−4064 +(column+.5)×8128/(1024×2^z), 4064−(row+.5)×8128/(1024×2^z))`. This distinction prevents a half-pixel drift.

For screen coordinates on the north-up picture, use eastward `u = 100×(E+4064)/8128` and southward `v = 100×(4064−N)/8128`, where `(E,N)` are our local projected easting/northing. These are picture coordinates, **not engine x/z** and not geographic longitude/latitude. Overlay rendering belongs to the game; it is absent from every tile.

## Exact conversion to the engine (checked for round two)

Checked against [Maps as files](../../../../../planning/reference/maps.md), section “A folder of layers”, and the input contract and reader used by [tools/map.ts](../../../../../tools/map.ts). The engine origin is the **south-east** corner; **+x is west**, **+z is north**, and +y is height. Our vectors use east-positive `(E,N)` metres from the centre. Convert positions as follows, without swapping the axes:

```text
engine.x = 4064 - E
engine.z = 4064 + N
engine.y = elevation_metres

E = 4064 - engine.x
N = engine.z - 4064
```

| Point | Our (E,N), metres | Engine (x,z), metres |
|---|---|---|
| NW | (−4064,+4064) | (8128,8128) |
| NE | (+4064,+4064) | (0,8128) |
| SE, engine origin | (+4064,−4064) | (0,0) |
| SW | (−4064,−4064) | (8128,0) |
| Centre | (0,0) | (4064,4064) |

Thus our 4,065² north-up sample `(column,row)` maps to `x = 8128−2×column`, `z = 8128−2×row`. **Do not mirror the PNGs before giving them to the layer importer**: its north-up contract already places the upper-left pixel at maximum x and maximum z. For a tile image with whole-map side `P=1024×2^zoom`, pixel centre `(c,r)` maps to `x=8128×(1−(c+0.5)/P)`, `z=8128×(1−(r+0.5)/P)`. Tile columns still increase eastward on screen, so engine x decreases as the tile column increases.

Engine yaw starts at north and turns toward west (+x). For a projected direction `(dE,dN)`, use `yaw = atan2(−dE,dN)×180/π mod 360`: north 0°, west 90°, south 180°, east 270°. A vector angle θ measured counterclockwise from projected east, as in `future_changes.geojson`, becomes `(θ−90°) mod 360`. The horizontal transform is a reflection (determinant −1), so polygon ring winding reverses if transforming vertices; preserve/recompute exterior/hole semantics rather than interpreting the old winding blindly.

Height values remain `value/100−100` metres NAVD88. The example engine height encoding is different; a later world builder must decode these heights and re-encode using its chosen `minY`/`stepY`. This note does not create an engine map file, choose version-2 fields, or assert a sea-level datum conversion.

| File | Encoding |
|---|---|
| height.png | Unsigned 16-bit. Height in metres NAVD88 = value/100 − 100. NOAA heights converted from US survey feet with 1200/3937. Bilinear reprojection; 1 cm quantization. |
| height_valid.png | 8-bit: 255 surveyed DEM coverage; 0 absent. Missing heights use −1 m in height.png. **This is an explicit engine convention, not measured bathymetry.** |
| water.png | 8-bit: 1 TIGER water polygon; 0 land. Water beneath elevated bridges is retained. |
| roads.png | 8-bit: 0 none; 1 local/service/path; 2 arterial/highway; 3 road over source water; 4 subterranean tunnel (not painted as a surface bridge); 5 authored missing bridge span. TIGER centerlines are measured geometry; corridor widths are authored: 22 m highway, 14 m arterial, 8 m local, 3–7 m paths/ramps/service. |
| buildings.png | 8-bit: 1 footprint; 0 outside. FEMA/ORNL USA Structures. Includes actual courtyards/holes where supplied. |
| landcover.png | 8-bit NLCD 2021 codes, nearest sampling. 11 water; 21 developed open; 22 low-intensity development; 23 medium; 24 high; 31 barren; 41 deciduous forest; 42 evergreen; 43 mixed; 52 shrub; 71 grass; 81 pasture; 82 crops; 90 woody wetland; 95 emergent wetland; 255 source nodata. Native source is ~30 m, not 2 m. |
| biome.png | Authored succession: 1 water; 2 open urban land; 3 reclaimed vegetation; 4 coastal mangrove; 5 low wetland; 6 sand; 7 ruin footprint; 8 road; 9 bridge. Derived from NLCD, DEM, shore distance and exact geometry. These are fictional future conditions, not surveyed present vegetation. |
| flooded_streets.png | Authored standing water: 1 low street pool; 0 other. Road land below 0.55 m NAVD88, within 300 m of the surveyed coast, excluding buildings; small artifacts removed. Coast geometry is unchanged. |
| bridge_gaps.png | Authored missing spans: 1 gap region; 0 other. Intersect with road-over-water to remove the deck. Four precise vector polygons are in future_changes.geojson. |
| wrecks.png | Authored submerged hulls: 1 footprint; 0 other. Four original fictional objects, not recorded real wreck sites. Positions and outlines in future_changes.geojson; the water above them remains water. Round-two z0/z1 show enlarged cartographic wreck symbols at these exact centres and directions; use this layer/vector for physical dimensions, never the distant symbol's painted extent. |
| painted_canopy.png | 8-bit: 1 added future-world vegetation crown; 0 other. Authored from the registered finest-scale original paintings, excluding water, roads, buildings and beach. Union with biome vegetation classes 3–5 for world placement. Not a tree survey and does not encode heights. |
| buildings_attributes.json | Per footprint id (`OBJECTID`, the `id` of buildings.geojson): the USA Structures fields named in `fields`, a row each in `rows`. `HEIGHT` is metres, null where the source has none; `OCC_CLS` and `PRIM_OCC` are its occupancy classes. Added for the world build; see SOURCES.md. |

Four files use a finer grid: `water_fine.png`, `buildings_fine.png`, `roads_fine.png`, and `painted_canopy_fine.png` are 8,192 × 8,192 pixel areas across the same bounds. They use the same respective class encodings. **Use these canonical fine masks or the vectors for world feature placement:** very thin source features can disappear between 2 m samples. These masks supply the finest painting's geometric support; round-two shore ink may thicken, thin and waver within the narrow finishing band. The 4,065-sample layers are convenient engine-grid companions, not a lossless substitute for the fine outlines.

The fine canopy preserves close-scale crown outlines and controls vegetation in the round-two z2/z3 finish. The far views use generalized district wash and representative palm/grove symbols, not individually placed tree crowns. `painted_canopy.json` records provenance and counts. At the inclusive grid's four outer sample lines, classifications use the adjacent finest pixel inside the square, avoiding a false empty fringe caused by half-open polygon rasterization. `../reports/canonical-layers.json` records endpoint corrections. Road tunnels occupy class 4 only where there is no visible surface road; an intersecting surface road retains its surface class.

`areawater.geojson`, `roads.geojson` and `buildings.geojson` retain clipped vector geometry in the **local projected CRS**, not RFC 7946 geographic degrees. Their `crs` member declares it. Use them to render reference images afresh at every zoom. Do not enlarge the 2 m masks for close-scale shoreline tracing.

Known source limits: TIGER is cartographic rather than a modern cadastral coastline survey; FEMA excludes many structures below 450 square feet and does not certify sub-metre positional accuracy. A 1 px painting-registration score measures agreement with these inputs, not their accuracy on Earth. Source dates differ.

Round three adds the separate [NOAA bathymetry subset](bathymetry/README.md),
with Float32 NAVD88 elevations and its own geographic transform. It informs
watercolour structure only. Existing height.png, height_valid.png, water
polygons and future-world layers are unchanged. The missing-ground-height
convention above has not been silently replaced with seabed observations.
