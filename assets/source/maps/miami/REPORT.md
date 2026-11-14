# Miami — the drowned atlas

**Complete and accepted for this delivery.** Produced 2026-11-14, 17:28–19:38 UTC (about 2 h 10 min wall time). All 85 independently painted tiles, shared geographic layers, references, originals, prompts, measurements and reproduction tools are present.

## Delivery and geography

This is an original painted atlas of an **8,128 × 8,128 m** square: downtown and Brickell, the port, Biscayne Bay, the Venetian and other island chains, South Beach, Fisher Island, and northern Virginia Key. The projection is a local WGS84 Transverse Mercator centred at 25.78° N, 80.166° W, scale 1. Bounds are −4,064 to +4,064 m on both axes. North is up; grid/true-north convergence is below 0.018° at the edges.

| Corner | Longitude | Latitude |
|---|---:|---:|
| Northwest | −80.2065295168 | 25.8166780455 |
| Northeast | −80.1254704832 | 25.8166780455 |
| Southeast | −80.1254954055 | 25.7433104873 |
| Southwest | −80.2065045945 | 25.7433104873 |

| Zoom | Canvas | Tiles | Metres per pixel |
|---|---:|---:|---:|
| 0 | 1,024² | 1 | 7.9375 |
| 1 | 2,048² | 4 | 3.96875 |
| 2 | 4,096² | 16 | 1.984375 |
| 3 | 8,192² | 64 | 0.9921875 |

Every game tile is 1,024 × 1,024 RGB PNG, named `tiles/z<zoom>/<column>_<row>.png`, west to east and north to south. Tiles contain no lettering, border, compass or coordinate grid. `checks/viewer.html` provides an offline review viewer with optional separate overlays. `paintings/z*/final-master.png` stores the uncut canvases; `checks/overview_z*.png` provides small previews.

The engine foundation consists of 4,065 inclusive samples at 2 m spacing: exactly 4,064 cells, or 127 chunks of 64 m. Height is 16-bit PNG; classifications are 8-bit PNG. Canonical water, road, building and authored-canopy masks are additionally retained at 8,192² so narrow features survive world placement. [Layer encodings](base/VALUES.md) explain units, values, vertex versus image-pixel registration, and the normalized 0–100 overlay transform. `map.json` is the machine-readable geographic contract.

## Sources and fictional changes

[SOURCES.md](SOURCES.md) records addresses, licences, attribution and what was taken. [downloads.json](downloads.json) records exact requests, dates, byte counts and SHA-256 checksums. Downloads are ignored under `raw/`.

- NOAA's 2021 Miami-Dade bare-earth DEM: 369 intersecting tiles, CC0. Converted from NAVD88 US survey feet to metres. Valid coverage includes **99.9714% of source land samples**; 2,203 land samples are missing. Surveyed heights range from −5.53 to 17.18 m.
- Census TIGER/Line 2025: 38 clipped hydrography polygons and 1,184 road features, public domain/CC0. These define the shore and road centrelines.
- FEMA/ORNL USA Structures: 11,919 clipped building footprints. The federal catalogue describes a government work, but the delivery item declares CC BY 4.0. Attribution is retained conservatively; include SOURCES.md when redistributing.
- USGS NLCD 2021: public-domain land-cover classes at their actual approximately 30 m source resolution.

Road widths are authored corridors around the source centrelines. Future mangrove/reclamation, low street flooding, four broken causeway spans and four submerged wrecks are explicit world layers. Added tree crowns were frozen from the complete registered finest-scale paintings, then reused by every zoom: 6,878,251 fine pixels, with a 4,065-sample companion for the engine. These changes describe an invented future, not present-day surveys.

## How the painting was made

The original [style sheet](style/style-sheet.png) and [written style specification](style/STYLE.md) came first: ivory rag paper, warm quill ink, limestone ruins, olive foliage, mineral-teal water and pale jade shallows. No other game's map image or commercial basemap was supplied to image generation. The earlier project test was inspected as a quality comparison.

Each zoom received a newly rasterized geographic reference at its own resolution. All **85 tiles have a separately generated original painting**; none of the final zooms is a resized lower-level painting. The image tool returned approximately 1,254 px squares. Finer paintings include 64 px overlap around a 1,024 px tile, and were made against the native geometry, a crop of the accepted parent painting, and the shared style sheet. All original outputs, used prompts and context crops are preserved.

Image generation alone did not preserve geography. Finishing registers the pigment to geographic corners using position-constrained SIFT/RANSAC similarity fits, with a multistart main-water-silhouette fit in sparse scenes and a small smooth local shoreline correction. Original paint supplies washes, quill texture, foliage and ruin interiors. Exact native vector masks control every visible coast, road corridor and building silhouette. A continuous shallow wash repairs exposed water without dragging masonry or tree fragments into the bay. Interior ruin partitions are illustrative, not surveyed floorplans.

Overlapping paint is blended with smooth 128 px transitions on one continuous canvas per zoom. Geometry and colour finishing then run across the entire canvas before it is cut into tiles. Broad material-local pigment matching keeps parent colours stable while retaining separately painted close detail. The finest authored canopy is shared by all zooms and saved with world data.

## Measurements

Final exported RGB measurements:

| Zoom | Water / road / building IoU | Max boundary error | Tile reconstruction error | Join-jump / nearby-jump range |
|---|---|---:|---:|---:|
| z0 | 1.000 / 1.000 / 1.000 | 0 px | 0 / 255 | No internal join |
| z1 | 1.000 / 1.000 / 1.000 | 0 px | 0 / 255 | 0.933–0.958 |
| z2 | 1.000 / 1.000 / 1.000 | 0 px | 0 / 255 | 0.884–1.171 |
| z3 | 1.000 / 1.000 / 1.000 | 0 px | 0 / 255 | 0.878–1.063 |

Adjacent zooms, reduced to their parent scale:

| Pair | Mean absolute RGB difference / 255 | 95th-percentile channel difference | 8 px blurred mean difference / 255 | Mean RGB shift / 255 |
|---|---:|---:|---:|---|
| z1 → z0 | 11.003 | 40 | 0.978 | +0.182, +0.087, -0.080 |
| z2 → z1 | 9.960 | 39 | 0.849 | +0.099, +0.111, -0.011 |
| z3 → z2 | 10.148 | 43 | 0.829 | -0.029, +0.112, -0.041 |

The final format audit passed: **85 RGB 1,024² tiles, 85 original paintings, all required prompts, grayscale base layers with correct sizes and bit depths**, and SHA-256 inventory. Whole-map views, the complete 64-tile closest-scale sheet, native downtown/island/port/beach/mangrove tiles, and joined-corner crops were inspected. No visible tile joins or accidental lettering were found. See [zoom comparison](checks/zoom_comparison.jpg), [joined corners](checks/native_seams.jpg), and [all close-scale tiles](checks/final_z3.jpg).

The additional engine-grid check exposed a half-open polygon endpoint convention and surface-road/tunnel overlap. Endpoint classes and tunnel precedence were corrected. The **canonical fine masks have zero differing pixels and zero boundary error** against the finest geographic references. The 2 m companions still quantize narrow source features:

| 2 m companion versus finest vectors | IoU | 95th-percentile boundary distance | Maximum boundary distance |
|---|---:|---:|---:|
| water | 0.998298 | 1 px | 4.000 px |
| roads | 0.907230 | 1 px | 23.195 px |
| buildings | 0.921490 | 1 px | 117.209 px |

The large maxima include very narrow/disappearing pieces and boundaries truncated by the map frame; they do not indicate a translation of the whole layer. **Do not use only the 2 m companions to reconstruct all fine outlines. Use `*_fine.png` or the supplied vectors for world feature placement.** Their finer resolution is necessary to preserve all source detail. The base height grid remains exactly 4,065².

Machine-readable results: [paint measurements](checks/measurements.json), [base-grid comparison](checks/base_grid_agreement.json), [delivery audit](checks/delivery_audit.json), and [endpoint corrections](checks/canonical_layers.json).

The geographic test classifies the final RGB pigments into water, roads and buildings, then compares those visible regions to native vector-derived masks. Water includes authored flooded streets; surface occlusion by bridges/buildings and authored bridge gaps is accounted for. These tests measure agreement with the supplied data, not the absolute surveying accuracy of that data. The distinct material palettes make the result directly inspectable; zero boundary error is a consequence of the constrained finish, not evidence that the image model traced perfectly.

Seam tests reconstruct every tile into its canvas and measure colour jumps at joins against nearby non-join boundaries. Parent comparisons use a 2× box reduction, with both raw RGB differences and an 8 px blurred comparison to separate native ink detail from broad colour agreement. Visual inspection remains necessary: correct masks alone did not catch the foliage and ghost-shoreline defects rejected during development.

## Artistic assessment and limits

The strongest result is the combination of Miami's distinctive island/port geometry with luminous water and fine, footprint-specific masonry. The pale street network remains legible beneath a game overlay; the closer drawings add room walls, courtyards, vegetation, flooded reaches and small wreck ribs without moving the world. Water-dominated tiles preserve open space.

The exact city fabric is denser at zoom 0 than a freely generalized explorer's atlas would be. That is the principal artistic compromise made to preserve every supplied building and road. Ruin interiors are symbolic, and some large structures still read as shaded masonry masses rather than fully exposed floorplans. Mangrove crowns are authored marks without surveyed heights. This is a map-art and shared-layer delivery, not a finished 3D terrain or building reconstruction.

TIGER is cartographic rather than a cadastral shoreline survey, FEMA omits some small structures, and source dates differ. Neither road widths nor individual tree crowns are measured. No bathymetry was acquired: missing DEM values use an explicit −1 m engine convention with a separate validity mask. Shallow-water colour is artistic and does not encode measured depth. NOAA point-cloud classifications and USGS 3DEP were not used because the selected DEM, footprints and land cover supplied the required layers.

## Time and handoff

| Stage | UTC | Elapsed |
|---|---|---:|
| Inspect first test, acquire sources, freeze bounds, original style | 17:28–17:35 | 7 min |
| Base layers, native references, whole-map painting | 17:35–17:43 | 8 min |
| Four district paintings | 17:43–17:47 | 4 min |
| Close district pilot and registration corrections | 17:47–18:10 | 23 min |
| Complete and inspect zoom 2 | 18:10–18:24 | 14 min |
| Remaining 60 zoom-3 originals, concurrent image requests | 18:24–18:59 | 35 min |
| Full assembly, island/foliage refinement, canopy freeze | 18:59–19:23 | 24 min |
| Final finishing, visual review, measurements, grid correction and audit | 19:23–19:38 | 15 min |

Detailed development history is in `checks/production-log.md`. Reproduction commands and pinned packages are in [the tool README](../../../../tools/mapart/README.md). The tool virtual environment is ignored. No engine/build dependencies were added, no other repository area was edited, and no git write command was run. Image generation is nondeterministic; saved originals make the finishing process reproducible.

Delivery is complete. `STATE.md` records the accepted artifacts and the handoff. No tile generation or finishing work remains.
