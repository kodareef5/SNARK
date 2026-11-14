# Miami — the drowned atlas, round three

**The far bay is repainted, five landmark stories are distinct, and the mainland quay has a living ink edge.** All 85 north-up, 1,024 × 1,024 RGB tiles are replaced in place. Twenty accepted originals are new: one overview, four district paintings and fifteen neighborhood water paintings. The accepted close land drawing and all 64 zoom-3 originals are retained.

[Whole-map painting](tiles/z0/0_0.png) · [Round two beside round three](reports/round3/whole-map-comparison.jpg) · [Four zooms](reports/round3/four-zooms.jpg) · [Previous report](reports/round2-report.md)

## The picture, judged beside round two

I would choose the new overview for the wall. Round two's uninterrupted teal was useful negative space but left the largest part of the picture unresolved. Now the eye can follow the dark passages on both sides of the port, their western turning areas, the narrow western waterway and the branching pale flats south of the port. Washes have irregular edges, pigment pools and paper grain. Deep quay water can meet land directly; there is no uniform distance-from-shore glow. These forms make the bay worth looking at while the warm land remains the first narrative focus.

Five places can be described without referring to labels: **the banyan growing through a circular arcade; the unequal drowned towers and fallen link; the reed-filled oval bowl; the stepped Deco gallery; the three open tanks in mangrove**. The retained port sheds and cranes supply a sixth. [Their pictures](reports/round3/landmark-pictures.jpg) are visibly different in silhouette, vegetation and implied history. This is my reading of the pictures, not a claim that a blind test with strangers was conducted. The small naming captions in this report's evidence sheets are outside the exported artwork.

The mainland's straight quays remain straight where the data says they are. The old parallel dashed trace is removed. A narrow, irregular-pressure line follows the real vectors, with subpixel wavering and occasional dry passages. [The old and new quay details](reports/round3/mainland-quays.jpg) show the difference. The port, broken spans, drowned ground, exposed parchment and accepted district masses remain.

Zoom 2 has fresh native water painting around the retained room drawings. Zoom 3 keeps its existing wave marks and brush strokes, with only the broad water wash brought into the same depth structure. [Unscaled close comparisons](reports/round3/retained-close-detail.jpg) show this preservation. [A coloured-cell and marker study](reports/round3/marker-overlay-study.png) remains readable across shallow and deeper water. It is an illustrative overlay, not an engine integration test.

## What depth is observed, and what is invented

New source: **NOAA NCEI's Miami 1/3 arc-second NAVD88 Coastal Digital Elevation Model**, published January 21, 2015, combining historical surveys through 2014. NOAA identifies it as a U.S. government work not subject to U.S. copyright. [NOAA metadata and licence](https://www.ncei.noaa.gov/access/metadata/landing-page/bin/iso?id=gov.noaa.ngdc.mgg.dem:5166), [technical report](https://www.ngdc.noaa.gov/mgg/dat/dems/regional_tr/miami_13_navd88_2015.pdf), [exact subset request, timestamp and checksums](reports/round3/bathymetry-source.json).

A lossless 995 × 909 Float32 subset is kept in [base/bathymetry/](base/bathymetry/README.md). The downloaded NetCDF has stale regional bounding attributes; its actual longitude/latitude coordinate arrays supply the correct placement. The retained GeoTIFF uses WGS84 as NOAA documents. No vertical datum conversion was applied.

The **broad positions and relative depths** of port cuts, turning areas, the western waterway, flats, and submerged bands toward the ocean come from this model. [The plain depth guide](reports/round3/depth-guide.png) makes that distinction inspectable. Each zoom samples the retained model at its own native resolution. Pigment uses `max(-elevation_NAVD88, 0)`; it does not assert a present or future sea level. At overview resolution, 2.145% of the authoritative surface-water pixels have nonnegative model elevations and receive the shallowest colour. Their original elevations remain in the TIFF. The older model does not move the TIGER shoreline.

**Fine wash edges, currents, wave strokes, ruin architecture and wreck interiors are invented.** The existing future-world layers still determine four missing spans and four wreck positions and bearings. Wrecks have four different internal drawings; their far symbols exaggerate size, as before. No additional wreck locations were invented. No historical shoreline reconstruction or coral-habitat dataset was acquired. The eastern submerged bands must not be described as surveyed coral reefs. Colour is an artistic interpretation of relative underwater relief, not recoverable chart depth. Original world height and validity layers remain unchanged; this separate model has not silently filled their missing values.

Other source terms and limits remain in [SOURCES.md](SOURCES.md): NOAA bare-earth height, TIGER water and roads, FEMA/ORNL footprints with retained CC BY 4.0 attribution, and USGS NLCD land cover. Mangrove succession, flooding and the post-human city remain fiction.

## Geometry, scale and delivery

The same **8,128 m square**, local WGS84 Transverse Mercator centred at 25.78° N, 80.166° W, is retained. Exact geographic corners are in [map.json](map.json). The 4,065 inclusive base samples represent 4,064 two-metre cells, or 127 chunks of 64 m. All **21 existing base data artifacts** have identical hashes to round two; only `VALUES.md` gains a bathymetry note, and the separate bathymetry folder is additive.

| Zoom | Canvas | Tiles | Metres/pixel | Drawing convention |
|---|---:|---:|---:|---|
| 0 | 1,024² | 1 | 7.9375 | Coast, major routes, district masses, landmark pictures and broad hydrography |
| 1 | 2,048² | 4 | 3.96875 | District pictures, selected avenues and finer water marks |
| 2 | 4,096² | 16 | 1.984375 | Native footprints and roads, fresh neighborhood water |
| 3 | 8,192² | 64 | 0.9921875 | Retained rooms, canopy, waves and fine brushwork |

The original distinction between far representative pictures and close geographic footprints holds. A banyan arcade or elevated tower is a district symbol, not a newly surveyed building. Native water/road masks constrain placement; close land is the accepted source-constrained drawing. No new building, coast or tree-position data is inferred from generated pictures. The quay pen varies by at most 0.63 pixel before antialiasing; its ink has finite width.

Tile names remain `tiles/z<zoom>/<column>_<row>.png`, west to east and north to south. There is no lettering, border, compass or grid in them. The engine rule in [base/VALUES.md](base/VALUES.md) is unchanged:

```text
x = 4064 - E
z = 4064 + N
```

NW is `(8128,8128)`, NE `(0,8128)`, SE `(0,0)`, SW `(8128,0)`. Keep the PNGs north-up; the importer handles sample reversal. No engine map file or runtime dependency was added.

## Measurements on the exported tiles

[Full measurements](reports/round3/measurements.json) and [SHA-256 inventory](reports/round3/sha256.json) are retained. The audit verifies 85 RGB tiles of the required size, 85 originals with prompts, base dimensions and bit depths, and **zero differing RGB values** when each tile set is reconstructed against its continuous canvas.

| Child → parent | Raw RGB mean error /255 | Broad error, Gaussian σ=8 parent pixels /255 | Broad error, σ=16 /255 |
|---|---:|---:|---:|
| z1 → z0 | 15.483 | **0.909** | 0.729 |
| z2 → z1 | 16.839 | **1.695** | 1.360 |
| z3 → z2 | 11.732 | **0.580** | 0.516 |

The child is reduced by a 2× box filter before comparison. Raw differences include deliberately different native drawings. The unselected σ=4 results are 2.824, 4.008 and 1.721; broad agreement does not mean individual marks coincide. Four continuous-canvas colour passes precede cutting; [their log](reports/round3/balance.json) is separate from measurements of the quantized exports.

All **140 join segments** are tested. Each across-join RGB jump is compared both with its two immediate neighboring jumps and with the other boundaries in a 66-boundary neighborhood.

| Zoom | Joins | Maximum immediate ratio | Maximum neighborhood ratio |
|---|---:|---:|---:|
| 1 | 4 | 1.179 | 1.100 |
| 2 | 24 | 1.181 | 1.455 |
| 3 | 112 | **1.215** | 1.401 |

The worst immediate result is z3, vertical x=6144, row segment 3: 2.648/255 across versus 2.181/255 beside it. The wider-window metric is different and its larger maximum is reported openly. [The eight highest immediate ratios](reports/round3/worst-joins.jpg), whole canvases and all-tile sheets show no visible tile seam. No join-specific blur or repair is used.

A fixed teal-colour classifier gives water intersection-over-union **0.981, 0.983, 0.993, 0.995** at z0–3. This is a palette diagnostic, not proof of survey accuracy. One-way proximity of source surface-water edges to classified pigment is within two pixels for 98.60%, 94.50%, 94.41%, 99.47%; maximum distances are 26.08, 29.27, 19.00 and 23.35 pixels. [Far outlier crops and masks](reports/round3/shore-pigment-outliers.jpg) expose tiny isolated mask features, small excluded structures and dark bridge passages that the pigment test does not represent reliably. These outliers are not concealed by quoting only global IoU.

A σ=2 high-pass comparison with the retained drawing gives z2 building correlation **0.9998**, z3 building correlation **0.9999**, and z3 water correlation **0.9981** with contrast ratio **1.0012**. This supports the visual finding that close detail survived the broad repaint. New z2 water is intentionally different. Depth/darkness rank correlation is 0.935–0.940 across overview reductions; that describes pigment ordering, not navigation accuracy.

## Reproduction and review evidence

The built-in image tool made all **20 new raster originals**. Exact prompts are beside them. The old z2 northwest original and all 64 z3 originals are byte-identical to round two. Selected new far land is blended into the retained accepted drawing; other land stays in that drawing before broad colour calibration. New water uses native paintings and observed depth, assembled continuously with overlapping gutters before exact tile cutting.

`paintings/z*/retained-paint.png` is an intentional production input, verified pixel-for-pixel against all 85 prior tiles. Frozen generation-time parents are retained too. This avoids relying on git history or ignored old masters to preserve accepted passages. References, registration images and finishing masters remain regenerable caches. [The current tools instructions](../../../../tools/mapart/README.md) reproduce the finish offline from kept files without new image calls or git access.

Both far registrations were rebuilt with their caches removed: zero differing values. Three sampled z2 registrations reproduce identical parameters and identical non-overlap interiors. A second complete balance, wreck-drawing and export pass produced **identical SHA-256 hashes for all 85 tiles**. The [reproduction record](reports/round3/reproduction.json) records this scope: it is not a second cold rebuild of every earlier finishing operation. Image generation itself is nondeterministic.

Every tile was inspected in contact sheets: [z1](reports/round3/all-tiles-z1.jpg), [z2](reports/round3/all-tiles-z2.jpg), [z3](reports/round3/all-tiles-z3.jpg), with native detail samples and the comparisons linked above. All decision evidence is under `reports/`, not ignored `checks/`.

## Where it still falls short

The five main stories are now individual, but many peripheral palms and small courtyard ruins still share the earlier vocabulary. The close views remain more geometric than a wholly freehand atlas. The far symbolic arcade and towers change to source-bound room plans at close zoom; colour agreement does not make that cartographic change continuous. Small broken spans are less immediately legible than drowned ground and skeletal towers. The historic coastal model cannot certify today's dredging or the future bay, and no coral identity or former coastline has been established. The overlay check uses representative cells rather than the game's actual UI.

Those are the remaining limits. The water, principal landmark pictures and far quay treatment requested in this round are complete; I would ship this version over round two. This is an artistic judgment with retained evidence, not an external acceptance claim.

Work ran from 20:48 to 21:48 UTC on November 14, 2026, about one hour. The [production log](reports/round3/production-log.md) records stages and rejected treatments; [STATE.md](STATE.md) records the final checkpoint. Work is confined to the two authorized directories. No git command that writes was run.
