# Saddle paint

Delivered all **22 pieces / 464,889 covered texels** of `pteranodon_saddle` at
**1,024 × 1,024**. The saddle is undyed: its entire region map is RGB black and
its base carries the study's natural colours. No animal maps, study inputs,
layout, or model files were edited.

[Game review](checks/game_review.png) · [Seat close](checks/look/saddled_seat_design.png) ·
[Side](checks/look/saddled_side_design.png) · [Front](checks/look/saddled_front_design.png) ·
[Rider](checks/look/saddled_rider_design.png)

## Construction

`paint.py` opens the accepted study's delivered base, height and packed maps on
every run. Missing deliverables invoke the study's own `build.py`; there are no
substitute swatches or frozen copies in this folder. The study and its originals
remain unchanged. The painter keeps one 2,048-square study material in memory
at a time and filters it before reducing it to the saddle's density.

The script also reopens the piece IDs, position and texel-size bakes. It reads
the pure numerical construction from `saddle.py` and `model.py`, without
importing or running Blender, to recover real perimeter distances and tube
coordinates. It matches the pinned topology fingerprint, final face winding
and triangle diagonals before interpolating attributes through
`saddle_layout.json`. The position bakes remain the authority for wear and
contact placement. There were **zero coordinate fallbacks** on this delivery.

| Pieces | Paint and placement |
|---|---|
| `seat_top` | Accepted supple russet hide, physically projected around the pad. A broad dark, smoother hip basin, smaller hand-rubbed patches at the front, and knee wear on the sides. Mottled hide pigment survives in the base; polishing reduces relief and roughness. |
| `seat_under` | Same hide with softer, darker contact occlusion and a slightly drier roughness. |
| `seat_edge` | Accepted burnished `hide_edge`, following the actual rim. Both perimeter distance and distance across the roll are measured in millimetres. The thick rear section retains small stitches instead of stretching them into spokes. |
| Girth and collar outer faces | Hide with a pale slanted stitch row beside each physical edge, fine burnishing, subdued rubbing and soft contact AO at the border. |
| `girth_edge*`, `collar_edge*` | The study's edge roll and sewing treatment. These cut faces are only 5 mm thick, so the sewing channel is moved to their middle while preserving the stitch's longitudinal size. |
| Girth and collar inner faces | Same hide, with contact shade confined to occlusion. Median sampling is approximately 3 mm/texel; individual stitches are consequently filtered away. |
| `strap_out`, `strap_in` | Hide along both breast straps, sewn outer borders, restrained contact occlusion inside. Each upper/lower chart is mapped independently to its own physical outline. |
| `cantle` | Accepted honey wood; grain follows distance along the bent bow. A strip matching the actual circumference is cropped from the study and corrected only for its wrap mismatch, keeping the fine grain at its physical scale. |
| `grip` | Honey wood at the short exposed feet, with the accepted close rope wrap over the loop and reduced roughness where palms rub. The wrap finishes over roughly 5 mm rather than ending with an abrupt colour cut. |
| `peg` | Honey wood along the foot-rest axis; a restrained 2.8 mm end-grain modulation on the actual caps and mild polishing through the middle. |
| `cantle_plate_out`, `cantle_plate_in` | Accepted waxy chitin; growth contours follow the bent bow and the plate's lower edge. The thin boundary is warmer/deeper in pigment. |
| `boss` | Same pale chitin, with growth contours following its circular edge. |
| `rope`, `rein` | The study's round four-strand plait, mapped by axial arc length and circumference, including the model's two separate foot-rest ropes. |
| `halter` | The study's three-strand twisted cord, enlarged to the model's 11 mm diameter. Closed head loops use an integral number of lay pitches. |

No new generated images were needed. The final base, height, roughness,
occlusion and region pictures are computed from the accepted delivered study
layers; additional wear, contact, projection and minor peg end-grain fields are
computed by this painter. No illumination direction is painted into base colour.
Contact darkening is in occlusion; form occlusion remains the composer's job.

## Physical sizes

- Outer hide: approximately 0.80–1.04 mm/texel; wood and chitin about
  0.86–1.03 mm/texel; halter/reins about 1.30 mm/texel.
- Source hide retains its 500 mm span, the edge and chitin their 250 mm spans,
  and wood its 400 mm span. Filtering retains broad pigment and grain without
  inventing oversized pores.
- Face stitching sits **7 mm in from the boundary**, retaining the study's
  **6.944 mm pitch**, **4.7–5.25 mm length** and **0.78–0.94 mm thread width**.
  The sewing channel and thread together supply a wider readable footprint.
  The thin girth/collar edge faces place that row about **2.5 mm** across the cut.
- Foot-rest plait: **13 mm diameter**, from the model's 6.5 mm radius; approximately
  **10.21 mm** chevron spacing. Reins: **12 mm diameter**, **9.425 mm** spacing.
- Halter: **11 mm diameter**, with nominal **34.56 mm** lay pitch, adjusted slightly
  to close each ring. Wrap: **4 mm cord** around the **32 mm grip**; approximately
  **16–23 mm** of wood exposed at the feet, with short transition zones.
- All heights share a **4.0 mm encoding range** (0–65535). The actual combined
  delivered relief range is **1.659 mm**, mostly rope. Plain hide remains very
  shallow; thread, rolled edges and plait crowns supply the larger relief.
  No normal map is delivered: `compose.py` derives it at each texel's real scale.

Representative delivered means (sRGB; roughness and AO linear):

| Piece | RGB | Roughness | Own AO |
|---|---|---:|---:|
| Seat top | 128.6, 72.0, 38.3 | 0.405 | 0.983 |
| Seat underside | 139.5, 77.8, 41.2 | 0.508 | 0.802 |
| Seat rim | 137.5, 77.8, 42.1 | 0.446 | 0.924 |
| Girth outer / inner | 135.5, 76.5, 41.4 / 140.2, 79.9, 43.6 | 0.430 / 0.508 | 0.962 / 0.765 |
| Cantle wood | 189.8, 150.8, 102.8 | 0.403 | 0.969 |
| Foot-rest plait | 198.5, 174.6, 131.8 | 0.820 | 0.893 |
| Halter cord | 198.5, 174.6, 131.8 | 0.810 | 0.903 |
| Cantle plate | 218.6, 207.5, 185.5 | 0.281 | 0.994 |

There are no dyed regions and therefore no neutral-grey/0.50 target.
Per-piece measurements and input hashes are in [metrics.json](checks/metrics.json).

## Review and verification

Ran the shared `look.sh` with **`--maps`**, using the existing prepared model
and the game's actual rgba material/shader path. Inspected all four saddled
design views, plus loud and dark rider views. The saddle keeps its own colours
in all of them. The close seat shows the darker rubbed basin, fine pale borders,
honey bow and closely wrapped grips. The side view preserves fine stitched lines
and distinguishes pale fibre, pale chitin and warmer wood against the fuzz.

The final rear rim no longer enlarges its stitches. The source's fine hide
pores and chitin pits disappear appropriately at distance; the larger pigment,
wood grain and rope crowns remain. At native renderer resolution, individual
threads are fine dashes rather than the much larger stitches in the concept
illustration.

Also inspected:

- [Original / accepted study / painted base / painted relief at 900 px/m](checks/source_study_painted_900ppm.png).
- [Atlas unlit and relit from opposite directions](checks/atlas_three_lights.png).
- [All 22 isolated pieces relit](checks/all_pieces_relit.png).

`check.py --rebuild` verifies the five PNGs plus `layers.json` reproduce byte for
byte. It checks exact alpha ownership, dimensions, 16-bit height, black regions,
height range, and unit derived normals. Model-space reconstruction agrees with
the independent 16-bit position bakes within **0.0173 mm** on every part.
The underlying plait, twist and wrap fields close **exactly** at one girth in
all sampled channels. The check separately records raster seam differences:
finite texel sampling and tube caps do not have identical pixels across their
cut, so exact source closure is not misreported as exact raster equality.
See [validation.json](checks/validation.json).

The final memory-bounded paint rebuild took **28.3 seconds**. Renderer review
used the prepared pack and required no Blender build.

## Limits and model observations

- The current shared renderer shows visible gaps below the cantle and grip
  feet, and exposed/intersecting strap boundaries around the chest. These are
  present in the supplied geometry/prepared pack; the paint cannot close the
  gaps or add missing attachment/lashing geometry. The pinned layout was kept.
- No modeller's saddle form-occlusion bake exists in this checkout. The images
  include the painted material/contact AO; `compose.py` will multiply a future
  form bake into it.
- The model mirrors the right side, so it also mirrors the chirality of the rope
  construction. Within each left-side tube the circumference closes correctly.
- The narrowest cut edges and 3 mm/texel inner faces cannot separately resolve
  sub-millimetre thread ply or fibre hairs. Front-facing rows carry the readable
  stitching; the thin cut edges contribute a fine pale line.
- The study's waxy chitin is opaque: there is no true transmission. Relief does
  not add loose fibres, knots, silhouette changes or physical stitch geometry.

## Rebuild

From the pteranodon directory:

```sh
python3 tex/paint/saddle/paint.py
python3 tex/paint/saddle/check.py --rebuild
zsh tex/paint/look.sh tex/paint/saddle/checks/look --maps
python3 tex/paint/saddle/check.py
```

Keep `paint.py`, `check.py` and this report. `layers/` and `checks/` are already
ignored by `tex/paint/.gitignore`. The last check refreshes the review contact
sheet after the game renderer finishes.
