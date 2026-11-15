# Saddle paint — accepted, round 2

Accepted in round 2. The repository tidy leaves `paint.py` and `check.py` unchanged.

Delivered all **22 pieces / 464,889 covered texels** of `pteranodon_saddle` at
**1,024 × 1,024**. The saddle is undyed: its entire region map is RGB black and
its base carries the study's natural colours. No animal maps, study inputs,
layout, or model files were edited.

[Game review](superseded/checks/game_review.png) · [Seat close](superseded/checks/look/saddled_seat_design.png) ·
[Side](superseded/checks/look/saddled_side_design.png) · [Front](superseded/checks/look/saddled_front_design.png) ·
[Rider](superseded/checks/look/saddled_rider_design.png)

## Accepted paint revision

Changed only `cantle`, `cantle_plate_out`, `cantle_plate_in` and `boss`.
All **395,206 texels** belonging to the other 18 pieces, including their colour,
height, roughness and occlusion, remain **byte-identical** to the incoming
paint. Alpha and the all-black region map are unchanged everywhere.
The incoming maps and views are retained locally in `superseded/checks/round1_before/`.

- **Bow grain:** the original arc coordinate was correct, but closing the wood
  strip with a full-width endpoint correction stretched the endpoint difference
  into transverse stripes. Removed that correction on `cantle` only. The
  accepted study's fibres now run continuously along the bow; a **6 mm** overlap
  closes the circumference at the rear. Its 400 mm source scale is retained.
  The bow's reconstructed centreline is **493.29 mm** end to end; the mirrored
  half is 246.64 mm. Position bakes independently verify the reconstruction.
- **Both plate faces:** warm bone/ivory pigment, deeper amber worn margins,
  faint growth layers following the physical upper/lower edges and tapered
  ends. The same edge-distance construction is used on both faces. The study's
  generated pigment and microrelief remain; additional shallow growth boundaries
  have roughly **7–9 mm** spacing and **2.1 mm** soft width, with at most
  **0.018 mm** added recession. The deeper edge colour falls away over **3.2 mm**.
  Roughness is about **0.410**, above the study's 0.285, to soften the formerly
  glossy response in this model and lighting.
- **Boss:** the same warm chitin, with layers ringing its actual 30 mm radius.
  The central worn crown is slightly paler, with quieter layers and relief.
  Roughness averages **0.446**. A narrow amber basal margin and contact AO on
  its skirt mark where it seats; the contact treatment falls away over
  **1.5–1.7 mm**. The accepted breast-strap paint is untouched.

### For the modeller: white patches at the breast straps

These are **body/strap intersections in the prepared game mesh**, not missing
paint or white marks in the saddle maps. All strap texels are opaque hide. A
forward-axis ray comparison against the actual finest body triangles from
`pteranodon.snpk` puts **807 of 12,885 outer-strap texels** behind the body,
with a worst forward clearance of **−10.149 mm** at approximately
**(0.08818, 0.83847, 0.20408) m** in animal coordinates, and the mirrored problem
on the other side. These are sampled surface texels, not a triangle count.
See [mesh measurements](superseded/checks/strap_geometry.json).

The mathematical shell used by `saddle.py` does not show that penetration:
its upper-strap samples clear the shell by at least 3.36 mm. The prepared
body's triangulated surface is the relevant obstruction. The modeller should
fit the upper breast straps to that surface and check the crossing/attachments.
Geometry, layout and strap paint were left as supplied, as requested.

The sections below describe the current full delivery; this round supersedes
the previous claims that the cantle already read correctly as longitudinal wood
and that the initial chitin treatment was sufficient.

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
| `cantle` | Accepted honey wood; grain follows distance along the bent bow. A strip matching the actual circumference is cropped from the study, with only a 6 mm overlap at the rear cut; no full-width endpoint correction remains. |
| `grip` | Honey wood at the short exposed feet, with the accepted close rope wrap over the loop and reduced roughness where palms rub. The wrap finishes over roughly 5 mm rather than ending with an abrupt colour cut. |
| `peg` | Honey wood along the foot-rest axis; a restrained 2.8 mm end-grain modulation on the actual caps and mild polishing through the middle. |
| `cantle_plate_out`, `cantle_plate_in` | Accepted waxy chitin; growth contours follow the bent bow and the plate's lower edge. The thin boundary is warmer/deeper in pigment. |
| `boss` | Warm layered chitin, with concentric growth, a worn paler crown and an amber/contact-AO seating margin. |
| `rope`, `rein` | The study's round four-strand plait, mapped by axial arc length and circumference, including the model's two separate foot-rest ropes. |
| `halter` | The study's three-strand twisted cord, enlarged to the model's 11 mm diameter. Closed head loops use an integral number of lay pitches. |

No new generated images were needed. The final base, height, roughness,
occlusion and region pictures are computed from the accepted delivered study
layers; additional wear, contact, projection, shallow growth contours and minor
peg end-grain fields are computed by this painter. No illumination direction is painted into base colour.
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
| Cantle wood | 189.8, 150.8, 102.8 | 0.404 | 0.969 |
| Foot-rest plait | 198.5, 174.6, 131.8 | 0.820 | 0.893 |
| Halter cord | 198.5, 174.6, 131.8 | 0.810 | 0.903 |
| Cantle plate outer | 208.4, 193.4, 165.8 | 0.410 | 0.989 |
| Cantle plate inner | 208.4, 193.4, 165.7 | 0.410 | 0.939 |
| Boss (including back and skirt) | 199.4, 185.5, 160.0 | 0.446 | 0.775 |

There are no dyed regions and therefore no neutral-grey/0.50 target.
Per-piece measurements and input hashes are in [metrics.json](checks/metrics.json).

## Review and verification

**Final round-one review:** regenerated with `look.sh --maps` and inspected
`saddled_front`, `saddled_seat` and `saddled_rider` at native size, plus enlarged
front crops. The bow now carries long fibres around the bend without the
crosswise woven appearance. Both plate faces are warmer and less glossy;
faint contour bands survive at the front, while the rear-facing sliver is much
smaller in the seat/rider cameras. The boss has visible concentric pigment,
a quieter pale crown and a deeper seating margin. Its mesh stays rounded.
[Incoming/final front comparison](superseded/checks/round1_front_comparison.png).

The renderer still gives the shaded bevels a cool sky-light contribution;
there is no blue pigment in the chitin. Fine growth detail remains restrained
at native screen size and is easier to inspect in the enlarged comparison.
The white jagged strap intersections remain unchanged for the modeller.


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

The round-one renderer review uses the prepared pack and requires no Blender
build. `check.py` also verifies the new wood wrap closes exactly, that forward
wood fibres vary more across the bow than along it, and (when the archived
incoming maps are restored to `checks/round1_before/`) that changes are confined
to the four requested pieces.

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

The last check refreshes the review contact sheet after the game renderer finishes.

## Files

Retained: `paint.py`, `check.py`, the review source `review_round1.ts.txt`,
this report, `BRIEF.md`, both feedback files and both `artist_*.last.txt` files.
Including `.gitignore`, these 10 retained files total about **76 kB**.
The painter needs Python, NumPy, Pillow and SciPy; it reads the shared geometry,
layout and bakes and the saddle study's own delivered layers in
`tex/studies/saddle/`, invoking that study's unchanged `build.py` if needed.
There are no local `source/` inputs or regenerated source files; originals and
their prompts remain with the study.

The local `.gitignore` excludes `layers/`, `checks/`, `superseded/` and Python
caches. Earlier deliveries, checks and diagnostics are archived in
`superseded/`; both TypeScript helpers were renamed to `.ts.txt`, leaving no
`.ts` files anywhere in this folder.

Two runs with `layers/` absent before each run rebuilt all five PNGs and
`layers.json` **byte for byte**, matching each other and the accepted delivery.
The second run started from `/private/tmp`. The painter, checker, study and
shared input hashes stayed unchanged. [SHA-256 audit](superseded/clean_rebuild.json).
`check.py` passed on the rebuilt delivery; [validation](checks/validation.json).
