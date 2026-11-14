# Miami — the drowned atlas, round two

The distant map has been redrawn as an illustrated atlas. **Zooms 0–2 have 21 new accepted original paintings; zoom 3 keeps its 64 original room paintings with a new paper, coast and district finish.** The delivery remains 85 north-up, 1,024 × 1,024 RGB tiles. Geography and world layers are unchanged.

[Open the whole-map painting](tiles/z0/0_0.png). [Original style sheet](style/style-sheet.png). [Production log](reports/round2-production-log.md). [Reproduction instructions](../../../../tools/mapart/README.md).

## What changed, by looking

The old overview's eleven-thousand-building mesh is gone. The bay, islands and causeways organize the picture. Downtown is a few skeletal tower groups rising out of flooded green ground; the port has roofless sheds and rust-coloured cranes; the beach has long pale hotel ruins; western neighborhoods have low courtyard shells; parks and southern shores have groves and directional grass hatching. Ivory ground shows between them. The principal roads remain geographical guides, without every local street competing with the scene or future game markers.

Zoom 1 adds district detail, still with deliberate omissions. Zoom 2 returns to the actual neighborhood fabric and has been repainted throughout: open rooms, broken warehouse bays, palms, exposed paper and more economical ground marks. Zoom 3 retains the first round's rich interiors. Warm port trusses and pale hotel galleries distinguish those footprints; downtown masonry is cooler and heavier. These district conventions are an interpretation of the future city, not an additional building-use survey.

The shoreline now has varying ink pressure, small deviations, pen lifts at beaches, a second broken stroke at urban quays, and a shallow wash that follows the source coast. It is no longer one constant dark vector stroke. The coast's underlying land/water division stays at the native data boundary; ink is permitted a narrow finishing band around it.

Flooded road corridors, four missing spans and four wrecks still come from the saved future-world layers. The overview emphasizes drowned downtown and mangrove reclamation. Wreck symbols are enlarged at z0/z1 so they survive that viewing distance; their centres and directions are exact, but their pictorial size is not a physical footprint. At z2/z3 the hull drawing uses the actual saved outline.

## Geography and scale contract

The map covers **8,128 × 8,128 m**: downtown and Brickell, the port, Biscayne Bay, the Venetian and other island chains, South Beach, Fisher Island, and northern Virginia Key. Local WGS84 Transverse Mercator is centred at 25.78° N, 80.166° W, scale 1, with bounds −4,064 to +4,064 m in easting and northing. Grid/true-north convergence is below 0.018° at the edges.

| Zoom | Native canvas | Tiles | Metres per pixel | What is drawn |
|---|---:|---:|---:|---|
| 0 | 1,024² | 1 | 7.9375 | Exact coasts, islands, causeways and principal roads; generalized district wash and landmark pictures |
| 1 | 2,048² | 4 | 3.96875 | Same geographical skeleton, selected additional avenues, more ruin groups |
| 2 | 4,096² | 16 | 1.984375 | Native road corridors and building footprints, newly painted neighborhood detail |
| 3 | 8,192² | 64 | 0.9921875 | Native footprints, retained room paintings, canopy and fine shore/district treatment |

Names remain `tiles/z<zoom>/<column>_<row>.png`, with columns increasing eastward and rows southward. Every tile has no lettering, border, compass or grid. No engine map file was made.

The far geometric plans provide **32 spaced footprint anchors at z0 and 128 at z1**. These anchors direct an illustrator; they are not a claim that a generated tower's every window or projected upper storey coincides with a surveyed building. At those scales, ruins and groves are representative pictures of districts. Elevated crane arms can project over water and skyline symbols can occlude a road. Do not extract world footprints or tree positions from those pictures. At close scales, native masks clip masonry to supplied footprints; interior walls and structural bays are invented ruin drawings.

All **21 base data artifacts** checked against round one's audit have unchanged hashes; only their interpretation document, VALUES.md, changed. The base foundation is 4,065 inclusive vertex samples at 2 m spacing: 4,064 cells, or 127 chunks of 64 m. Use the canonical 8,192² masks or vectors for fine feature placement; the 2 m companions cannot preserve every narrow feature. [Integrity check](reports/base-integrity-round2.json), [original grid quantization measurements](reports/base-grid-agreement.json), [endpoint corrections](reports/canonical-layers.json).

## Engine coordinates: do not mirror this map

Checked against `planning/reference/maps.md`, `tools/map.ts` and the actual north-up layer reader in `tools/map/layers.ts`. Our `(E,N)` is east/north from the centre. The engine's `(x,z)` is west/north from the south-east corner:

```text
x = 4064 - E
z = 4064 + N
```

North-west is `(8128,8128)`, north-east `(0,8128)`, south-east `(0,0)`, south-west `(8128,0)`. **Keep the PNGs north-up; the importer already reverses the sample order.** [base/VALUES.md](base/VALUES.md) also gives inverse transforms, vertex and pixel-centre formulas, yaw conversion, reflected polygon winding and height-encoding cautions. [Corner/direction check](reports/coordinate-check.json).

## How the artwork is reproduced

Every new raster painting was made with the built-in image tool. There were **23 image calls**: 21 replacement originals, one preceding overview study retained as an art-direction input, and one preceding northeast district painting retained for its targeted correction. The correction removed erroneous port cranes from residential Belle Isle. The exact used prompts, accepted originals and these supplementary inputs are kept. The original 64 z3 paintings are unchanged. No external comparison artwork was supplied to generation.

Far views use native generalized plans and similarity registration. An early elastic correction bent architectural drawings and was rejected. Narrow displaced coast marks are cleaned before the native coast is redrawn. Close views use the established position-constrained SIFT/RANSAC registration, shoreline fallback and small local correction. Original pigment supplies penwork, rooms, plants and wash; native geometry controls material placement. A 64 px gutter gives neighboring paintings a 128 px shared blend interval.

Each zoom is assembled and finished as **one continuous canvas**. Paper, coast ink, district treatments and broad colour adjustments happen before cutting any tile. A symmetric, seven-pass RGB wash adjustment shares differences between neighboring scales without spatially moving native marks. It replaced earlier local transfer experiments that produced halos or muddy foliage. Wreck symbols are applied before the final cut as well. No special blur or edge repair is applied at tile joins.

The finishing masters, references, registration-image caches and review pictures are ignored and reconstructible. The kept originals, style sheet, base layers, prompts, code and pinned packages are sufficient. Run the current round-two sequence in [tools/mapart/README.md](../../../../tools/mapart/README.md); the old `finish.py` entry point would restore the superseded all-features-at-all-scales treatment. Its registration helpers remain in use. Image generation itself is nondeterministic; finishing from frozen originals is reproducible. Verification rebuilt both far canvases from their originals with identical hashes, recomputed three representative close registrations without their caches with zero differing pixels, and reran all four scales' colour balance and export: all 85 final tile hashes were identical.

## Measurements and their limits

The format audit passes: **85 RGB 1,024² tiles, 85 accepted originals, corresponding prompts, correct grayscale base sizes and bit depths**. Each tile set reconstructs its uncut canvas with **zero differing RGB values**.

| Parent comparison | Raw mean absolute RGB difference /255 | 8 px blurred mean difference /255 | Mean RGB shift /255 |
|---|---:|---:|---|
| z1 → z0 | 13.645 | **0.802** | +0.492, +0.519, +0.530 |
| z2 → z1 | 15.738 | **1.440** | +0.662, +0.578, +0.645 |
| z3 → z2 | 11.622 | **1.028** | +0.480, +0.500, +0.516 |

All three broad-colour comparisons remain below 2/255. Raw differences are larger because a far landmark picture and a close floorplan are intentionally different drawings. The test reduces the child by a 2× box filter and compares exported RGB, with an 8 px Gaussian comparison separating broad pigment from native detail.

All **140 tile-edge segments** were measured independently: 4 at z1, 24 at z2, 112 at z3. The mean absolute RGB jump across each join is compared with the other boundaries in a 66-boundary neighborhood.

| Zoom | Join-ratio minimum | Join-ratio maximum | Reconstruction error |
|---|---:|---:|---:|
| z0 | — | — | 0 |
| z1 | 0.956 | 1.118 | 0 |
| z2 | 0.643 | 1.568 | 0 |
| z3 | 0.458 | 1.401 | 0 |

**The raw worst ratio is higher than round one's independently reported 1.29; that numerical bound is not claimed here.** The largest value is at z2, horizontal y=1024, segment x=1024…2047. A real building wall lies across the first 44 pixels of that cut: its jump is 39.88 versus 12.31 beside it. In the large open-water portion, x=1152…2047, the join jump is 1.47 and the adjacent jumps average about 1.51. Inspection of the largest ratios, native joined strips and complete contact sheets shows continuous painting, not a tile-shaped colour or drawing discontinuity. Softening every wall to improve that statistic was tested and rejected. The complete unselected set of ratios is retained, not just favourable examples.

The independent teal-pigment diagnostic puts **99.38–99.61% of sampled source shoreline pixels within 2 pixels** of a visible teal edge. Its maximum distances are 5.10, 17.03, 19.00 and 19.03 pixels by zoom. Inspection locates the largest outliers at crane symbols, dark thin causeway decks, quays and grey/green water: a palette classifier cannot distinguish every ink or flood mark from coastline. These numbers are **one-way pigment proximity, not full coast IoU and not a certificate of surveying accuracy**. The coast ink's mathematical wavering is at most 0.66 pixel; thickening/double strokes occupy a wider narrow band. Exact selected-road support matches the source-rendered corridors at every zoom, before pictorial occlusion. Neither support identity nor a pigment score proves the correctness of every illustrative detail.

Evidence is kept outside ignored `checks/`: [all exported measurements](reports/round2-measurements.json), [delivery audit](reports/round2-delivery-audit.json), [tile/original/base hashes](reports/round2-sha256.json), [colour adjustment](reports/round2-balance.json), [shore diagnostic locations](reports/coast-diagnostic-locations.json), [registration reproduction](reports/round2-registration-reproduction.json), [export reproduction](reports/round2-reproduction.json). The old measurements remain explicitly labelled [round one](reports/round1-measurements.json).

## The wall test, and where this still falls short

I put the whole-map image beside **Caroline Harper's [Sea of Thieves commission](https://www.carolineharper.com/portfolio-2/sea-of-thieves)**, **Joan Blaeu's [Amsterdam, 1649](https://www.mapsperhaps.com/products/amstelodami-celeberrimi-hollandiae-emporii-delineatio-nova-1)**, and **Pauline Baynes's [Middle-earth map, reproduced by the Library of Congress](https://blogs.loc.gov/loc/2016/10/lcm-mapping-the-imaginary/)**. They were comparisons for visual criticism only; their lettering, borders, figures and decorative devices were not imported into the tiles.

For this brief, **I would frame this Miami overview**. The open teal bay gives the skeletal skyline, diagonal port and pale beach a clear composition at viewing distance. The change from a tiny street plan to a few purposeful pictures is decisive. The paper and quiet water also leave room for the game's coloured cells. This is an artistic judgment, not evidence that every stranger would prefer it to those maps.

It still falls short of those illustrators in the individuality of every small mark. Some palms and courtyard ruins repeat a common vocabulary; Baynes has more local surprises and Harper more varied miniature narratives. The close views remain more geometric than a wholly freehand atlas because actual footprints are enforced. Large quays and straight causeways still reveal their engineered geometry. The real missing spans are small at overview scale; drowned ground and skeletal towers carry more of the first glance than those breaks. Broad colour continuity cannot make a miniature tower turn continuously into a top-down room plan: the zoom change deliberately changes the cartographic convention. Those are visible limits, not claims concealed by a successful numerical audit.

## Sources and world-building limits

[SOURCES.md](SOURCES.md) retains attribution and licences; [downloads.json](downloads.json) retains exact requests and source hashes. Geography was not reacquired or changed in this round:

- NOAA 2021 Miami-Dade bare-earth DEM, 369 intersecting tiles, CC0. Surveyed coverage is 99.9714% of source land samples; 2,203 land samples are absent. Heights −5.53 to 17.18 m NAVD88, converted from US survey feet.
- Census TIGER/Line 2025: 38 clipped water polygons and 1,184 road features. Shorelines are cartographic, not cadastral; road corridor widths are authored around source centrelines.
- FEMA/ORNL USA Structures: 11,919 clipped footprints. The delivery item declares CC BY 4.0; retain the conservative attribution in SOURCES.md when redistributing.
- USGS NLCD 2021: land-cover classes at their actual approximately 30 m source resolution.

Reclamation, mangrove, low-street flooding, bridge gaps, wrecks and the frozen painted canopy describe an invented future. Room walls, crane shapes, tower heights and hotel/gallery treatments are illustrative. Source dates differ; FEMA can omit smaller structures. No bathymetry was acquired. Missing height values use an explicit −1 m convention with a separate validity mask; shallow colour does not encode measured depth. This is artwork and shared geographic data, not a finished 3D world or an engine map file.

## Handoff

Round two began at 19:40 UTC on 2026-11-14. The [production log](reports/round2-production-log.md) records painting, rejected trials, finishing, visual review and final validation. [STATE.md](STATE.md) records the completion checkpoint. Work is confined to `assets/source/maps/miami/` and `tools/mapart/`. No git command that writes was run.
