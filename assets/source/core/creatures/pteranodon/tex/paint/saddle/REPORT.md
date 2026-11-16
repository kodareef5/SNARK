# Saddle paint — round 3

The accepted saddle is rebuilt on the modeller's corrected bakes. `paint.py`
now reads the published surface data through `surface.py`; it does not read,
import, extract, or execute `saddle.py`, `model.py`, or `rig.py`. It needs no
Blender, body object, prepared mesh, or private constructor signatures.

Delivered **22 pieces / 464,889 covered texels**, **1,024 × 1,024**. The five
PNGs and `layers.json` rebuild byte for byte. The saddle remains undyed, with
an entirely black region map. No study, shared bake, layout, model, or other
painter's files were edited for this round.

[Game review](checks/game_review.png) · [Front](checks/look/saddled_front_design.png) ·
[Seat](checks/look/saddled_seat_design.png) · [Side](checks/look/saddled_side_design.png) ·
[Rider](checks/look/saddled_rider_design.png)

## Published data and reconstruction

Every run reopens `saddle_layout.json`, the current piece IDs and metadata,
16-bit position maps and texel-size map in `tex/paint/`, and the curvature
bake in `ref/bakes/`. The accepted study's `study.json`, base, height and packed
maps are also reopened. If its deliverables are absent, the study's own
unchanged `build.py` regenerates them.

The layout publishes face numbers, piece names and a packed UV-corner stream;
it does **not** publish model-space vertices or polygon arities. `surface.py`
recovers the unique triangle/quad partition using convex UV polygons and the
piece map. It fits corner positions to the current baked texel positions,
trying both quad diagonals and keeping the fit that agrees with the bake.
It welds coincident corners within **0.06 mm**, orders the resulting boundary
edges, and walks tube rings through adjacent quads. All ordering is stable.
Invalid or ambiguous data raises an error rather than invoking a modeller.

This yields the seat rim and rolled depth, each girth/collar edge, each
breast strap's outline, both foot-rest ropes, the cantle/grip/rein/halter
centrelines and radii, the plate's grid, and the boss's basal plane and radius.
Published half-surfaces are measured with the saddle's mirror convention;
the midline is not mistaken for a physical edge. No model-space shape,
constructor constants, tube vertex counts, or private triangulation code is
copied into the painter. The seat's paired edge faces and plate's two-quad
strip retain their semantic order in the pinned layout.

The largest per-face fit residual is **0.01573 mm**. After corner welding and
rasterization, the maximum discrepancy against the position maps is
**0.01447 mm**, below the check's 0.025 mm limit. There were **zero coordinate
fallbacks**. Quantized bake measurements explain tiny numerical changes even
on parts whose shape did not move; matching the old PNG bytes is not the goal
when the physical surface changes. Repeated builds from the same inputs do
match exactly.

The new cantle centreline measures **631.92 mm** end to end (**315.96 mm** on
the published half), and the grip **365.77 mm**. Their measured radii remain
**20 mm** and **16 mm**. Grain, wrapping and edge stitching now use these
current paths instead of the former constructor's paths. The peg's axis and
the boss's seating frame also come from the bakes, replacing fixed placement
assumptions. The boss's measured radius is **30.0002 mm**.

Input hashes, surface residuals, tube measurements, material means and fallback
counts are recorded in [metrics.json](checks/metrics.json).

## Accepted materials retained

The material sampling, colours, physical feature sizes, wear treatments and
chitin revision accepted in rounds 1–2 remain. This is a projection repair,
not a new material treatment.

| Pieces | Paint and placement |
|---|---|
| `seat_top` | Supple oiled russet hide, a darker smoother hip basin, smaller hand-rubbed front patches and knee wear. Broad pigment mottling remains in the base. |
| `seat_under` | The same hide, with contact occlusion and a slightly drier roughness. |
| `seat_edge` | Burnished `hide_edge`, with distance along the actual rim and across both rolled segments measured in millimetres. Thick rear sections do not stretch the stitches into spokes. |
| Girth and collar | Hide on the outer and inner faces; pale slanted sewing beside each physical border; the study's rolled edge treatment on all four narrow cut-edge pieces. Restrained rubbing outside and contact AO inside. |
| `strap_out`, `strap_in` | The accepted hide and sewn borders, measured independently along each upper/lower strap's current outline. |
| `cantle` | Honey bent wood, with grain along the measured bend. The accepted local 6 mm overlap closes its circumference at the rear; there is no full-width endpoint correction to create crosswise stripes. |
| `grip` | Close cord wrapping over the measured loop, with short exposed wooden feet, a roughly 5 mm transition, and reduced roughness where palms rub. |
| `peg` | Honey wood along its measured axis, mild central polishing, and restrained 2.8 mm growth modulation on the actual end caps. |
| `cantle_plate_out`, `cantle_plate_in` | Warm waxy bone/ivory chitin, with faint growth layers following the upper/lower edges and tapered ends. Amber worn margins, with the accepted roughness increase. |
| `boss` | Warm layered chitin around its measured radius, a quieter paler crown, and a narrow amber/contact-AO seating margin. |
| `rope`, `rein` | The study's round plait, with axial arc length and circumference measured separately for each tube. |
| `halter` | Twisted cord, with an integral number of lay pitches round each mirrored head loop. |

Source spans remain **500 mm** for hide, **250 mm** for edge/chitin and
**400 mm** for wood. Study maps are filtered at the current measured texel
size before sampling; only one 2,048-square study material is retained in
memory at a time.

Face sewing sits **7 mm in from the boundary** with the accepted **6.944 mm
pitch**, **4.7–5.25 mm length** and **0.78–0.94 mm thread width**. Narrow
5 mm girth/collar cuts put their sewing channel about **2.5 mm** across the
cut. Foot-rest plait is **13 mm** across, reins **12 mm**, and halter cord
**11 mm**. The grip uses **4 mm cord** around its **32 mm** loop.

Chitin growth boundaries retain roughly **7–9 mm** spacing and **2.1 mm**
soft width, with at most **0.018 mm** additional recession. Warm edge pigment
falls away over **3.2 mm**; the boss's basal pigment and contact AO over
**1.5–1.7 mm**. Plate roughness averages **0.409** and boss roughness **0.446**.

All heights use the existing **4.0 mm** encoding range; the delivered relief
occupies **1.659 mm**, mostly rope. No normal map is delivered: `compose.py`
derives it from height and current texel size. Contact shading stays in
occlusion, and the composer multiplies the modeller's current form-occlusion
bake separately. No new images or replacement study swatches were generated.

## Game-renderer review

Ran `zsh tex/paint/look.sh tex/paint/saddle/checks/look --maps` on the prepared
corrected mesh and inspected all four requested **1,200 × 900** design views.
The incoming accepted layers were first rendered on that same mesh into
[round3_before/look](checks/round3_before/look/) for comparison.

- **`saddled_front`:** the breast straps and collar read as continuous russet
  hide; the former white jagged body-through-strap patches are gone. The boss
  retains its warm concentric layers and paler crown. The cantle has longitudinal
  wood grain and a warm pale plate; the plaited ropes and pegs retain their look.
- **`saddled_seat`:** the rubbed hip basin, fine pale rim sewing, honey grain
  following the bow, and close wrapping following the reshaped grips remain.
  The material follows the lowered cantle attachment and grip path. As in the
  incoming view, the forward hooked grip ends are exposed; no attachment
  geometry was added by painting.
- **`saddled_side`:** the fine sewn borders read at distance, and hide, wood,
  cord and chitin remain distinct against the ivory fuzz. The chest harness
  follows the corrected body clearance.
- **`saddled_rider`:** the longitudinal cantle grain, dark worn basin, rear
  stitched border and matching wrapped grips retain the accepted appearance.

The cool contribution on shaded bevels is still the renderer's sky lighting,
not blue chitin pigment. Fine thread and growth detail remain restrained at
native screen size. The old report's body-penetration diagnosis and missing
form-occlusion-bake note describe the earlier model and are superseded here.

## Verification

`check.py` validates dimensions, exact alpha ownership, 16-bit height, black
regions, finite relief within range and unit derived normals. It checks
surface agreement with the position bakes, continuous tube fields at one full
circumference, and the accepted cantle-grain direction. The underlying plait,
twist, wrap and wood fields close exactly. Raster seam differences are recorded
separately: finite texel sampling and caps are not claimed to have identical
edge pixels.

A changed-bake fixture scales every position by **1.125** and translates it
**17 mm up / 21 mm back**, leaving the layout unchanged. Reconstructed corners,
tube lengths/radii and the boss frame follow that change. A second fixture
bends the measured vertices by roughly 4 mm vertically and 3.4 mm fore/aft,
rebakes them in memory, and verifies that the recovered surface follows the
local change. Shared inputs are never edited by these tests.

`check.py --rebuild` makes two clean builds in a temporary asset containing only
`paint.py`, `surface.py`, the published input data and the study's delivered
layers/metadata. There are no modeller scripts or prepared model there. Each
run starts without `layers/`, from an unrelated working directory, with a
different `PYTHONHASHSEED` (**1**, **8675309**). Both runs reproduce all **six
files byte for byte**, matching the delivered set; input hashes are unchanged.

[Validation](checks/validation.json) · [Clean rebuild hashes](checks/clean_rebuild.json) ·
[All pieces relit](checks/all_pieces_relit.png) ·
[Atlas under opposite lights](checks/atlas_three_lights.png) ·
[Original/study/paint at 900 px/m](checks/source_study_painted_900ppm.png)

## Limits

- Surface positions are recovered from 16-bit bakes, so precision is limited
  by their quantization. The layout and bakes must describe the same mesh.
  An ambiguous corner stream, insufficient surface samples, or disagreement
  above 0.08 mm stops reconstruction with an error.
- This supports shape refinements under the pinned triangle/quad topology and
  chart semantics. A newly designed layout needs its own projection review.
- Right-side mirroring also mirrors rope chirality. Thin cut edges and roughly
  3 mm/texel inner faces cannot separately resolve sub-millimetre thread ply.
- Chitin is opaque, with no true transmission. Relief cannot add knots, loose
  fibres, physical stitches or attachment geometry.

## Rebuild

From the pteranodon directory:

```sh
python3 tex/paint/saddle/paint.py
python3 tex/paint/saddle/check.py --rebuild
zsh tex/paint/look.sh tex/paint/saddle/checks/look --maps
python3 tex/paint/saddle/check.py
```

The painter also runs from any working directory. The final check refreshes
the review contact sheet after rendering and preserves the rebuild verdict
only if its recorded delivery hashes still match.

## Files

- `paint.py`: accepted material projection and deterministic layer writer.
- **`surface.py` (new):** data-only layout decoding, baked corner fitting,
  connectivity, rim, tube, plate and boss measurements. No frozen shape data.
- `check.py`: surface/material checks, changed-bake fixture, review sheets and
  two isolated clean rebuilds.
- `REPORT.md`, `BRIEF.md`, **all three** `FEEDBACK_*.md`, all three
  `artist_*.last.txt`, `.gitignore`, and the retained historical review source
  `review_round1.ts.txt`.
- `layers/` (ignored): five generated PNGs plus `layers.json`.
- `checks/` (ignored): measurements, validation, clean rebuild hashes, current
  renderer views/review sheets and this round's incoming comparison.
- `superseded/` (ignored): reserved for previous local deliveries and diagnostics.

There are no local `source/` inputs or generated source copies. Originals and
prompts remain in the accepted saddle study. Runtime requirements are Python,
NumPy, Pillow and SciPy. `.gitignore` continues to exclude generated layers,
checks, superseded files and Python caches; no `.ts` file was added.
