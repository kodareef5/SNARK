# Legs, toes and claws — painted to the bird

Painted `leg_l`, `toe4_+188`, `toe4_+30`, `toe4_+4` and `toe4_-24` from the
accepted leg study. Start with the [concept-size comparison](checks/concept_comparison.png)
and [close foot view](checks/foot_ochre.png). The comparison uses **1500 pixels/metre
on both sides**, with no resizing of the concept crops or the projected painting.

## Placement and scale

- **Shank:** the accepted irregular front plates enlarged by **1.40×**, giving
  nominal 10–14 mm principal faces, with smaller gap fillers. Their centre faces
  forward and 18 degrees outward. The whole front half is plated; medium side
  plates grade continuously into small rear scales. Circumferential mapping has
  constant physical scale across the front, then accommodates the smaller rear
  drawing without an abrupt boundary. Both dimensions reduce around the ankle
  between 44 and 21 mm above ground. The hidden upper end becomes quiet beneath
  the trousers.
- **Toes:** separate phases of the accepted toe drawing, approximately 4–6 mm
  dorsal plates, smaller side scales and fine creases at the actual 0.30 and
  0.58 length stations. The sides use circumferential distance, avoiding stretched
  vertical streaks. Toe roots sample the same spatial ankle drawing as the shank.
- **Soles:** roughly 2–4 mm rounded pads from a small rear-scale patch of the
  accepted shank material. The study's periodic correction makes this patch
  reusable. It is mapped in the foot's plane across the heel and toe undersides,
  avoiding a radial pole on the heel cap. Pads have shallower relief and roughness
  around 0.75.
- **Claws:** the accepted natural horn, exclusively on the baked black texels.
  Length runs from model station 0.95 to 1.20, mapping the whole dark-to-worn
  gradient onto each exposed claw. Measured root RGB is approximately **77/70/63**;
  the final tip texels average **136/131/123**. Roughness goes from about 0.30 to
  0.205. Sparse growth traces remain subtle. A shared relief datum and calm collar
  avoid an artificial height step at the material boundary.

Placement uses the supplied 16-bit positions and the model's rest-form centreline
and toe stations, copied explicitly into `paint.py`. Positions decode directly
through the current `pieces.json` position box; both positions and object normals
describe the left side. Neither input is reflected. The paired-foot preview
duplicates the painted left foot by the model's shared-UV symmetry. No modelling
or layout files changed.

## Delivered layers

`layers/` contains five aligned **2048²** PNGs and `layers.json`:

| File | Contents |
|---|---|
| `dodo_base.png` | RGBA8 sRGB; generated intrinsic crease/grain drawing reconstructed by the accepted study code and sampled onto the form. Cyan areas are neutral; claws retain their natural colour. Alpha is exactly 255 on owned texels and zero elsewhere. |
| `dodo_height.png` | Linear greyscale16; **0.80 mm** full encoded range. Used values span about **0.077–0.472 mm**. Firm scale domes, shallower pads and smooth horn relief. |
| `dodo_rough.png` | Linear greyscale8; dry plates, rougher pads and polished horn. |
| `dodo_occlusion.png` | Linear greyscale8; the study's restrained fine material occlusion. The compositor adds the baked form occlusion. |
| `dodo_regions.png` | Exact baked cyan and black on the five owned pieces; zero elsewhere. |

No normal map is delivered by this group. `compose.py` computes it from the joined
height using each texel's physical size. All drawing remains in the base under
unlit viewing; no preview lighting or object occlusion enters that base.

## Checks

`check.py` passed coverage, dimensions, height bit depth, dye neutrality, mean grey
and exact region agreement. All **281,539** owned texels are covered: **271,616 cyan**
and **9,923 undyed claw** texels. Cyan's final linear mean is **0.500033**; dyed RGB
channels are identical. Individual pieces' cyan means range from 0.49414 to 0.50133.

The final composition completed without leg warnings. Its 56 region-ring breaks
are all between `beak` and `shell_face`; none involve the leg pieces. Other painters'
available layers were included; the body was still plain grey in that snapshot.
The composed preview maps are under `checks/composed/`.

Inspected [unlit islands](checks/islands_ochre.png), [front/side/back views](checks/foot_views.png),
[soles](checks/soles.png), [three relights](checks/relights.png), and
[eight dyes](checks/dyes.png): ochre, slate, olive, orange, pink, lime, near-black
and near-white. Broad front plates, finer ankles and rear scales remain distinct;
the claws keep their own colour in every dye. The sole inspection caught and
removed radial stretching on the heel. The rear wrap has no straight paint seam.
[Bird-size checks](checks/bird_sizes.png) include 200- and 50-pixel birds; individual
scales naturally disappear at the smallest size.

The previews project the **actual baked surface positions**, using the composed
normal, roughness and occlusion maps. They are Python point-splat inspections,
not a substitute foot model. Close views stop at the trouser-tip height of 101 mm
so the hidden upper shank is not presented as exposed skin. No Blender was run.

## Rebuild and source files

From the dodo directory:

```sh
python3 -B tex/paint/leg/paint.py
python3 -I -B tex/paint/compose.py --out tex/paint/leg/checks/composed
python3 -B tex/paint/leg/check.py
```

`paint.py` imports the accepted study's computation functions without running its
writer. It reads these unchanged originals, whose prompts remain beside them:

- `tex/studies/leg/source/r3_shank_generated.png`
- `tex/studies/leg/source/r3_toe_generated.png`
- `tex/studies/leg/source/r2_claw_generated.png`

There are no new generated originals. The other inputs are the piece IDs, positions,
texel sizes and region bake; exact input paths and hashes are in `layers.json`.
Pillow, NumPy and SciPy are required. `layers/` and `checks/` are ignored outputs.

A clean rebuild with `layers/` moved aside matched **all five PNGs and
`layers.json` byte for byte**, by SHA-256. All inputs remained unchanged. An audit
blocked writes outside this paint folder and reads from old outputs or
`superseded/`. Results are in `checks/rebuild.json` and `checks/validation.json`.

## Limits of the bakes and preview

The layout did not prevent the requested material placement. Its median sampling
is 0.446 mm/texel on the shank and 0.352–0.360 mm/texel on the toes, so the finest
study grain must filter away. The existing toe mesh is flatter and more faceted
than the rounded concept toes; painting cannot change that silhouette or the
geometry at the toe attachments. The Python views have point-sampling edges,
approximate specular lighting and no trouser cards; final silhouette, card overlap
and lighting should be judged in the game's renderer.

## Corrected position maps

Removed the old absolute-X workaround and rebuilt all five pieces using the
corrected left-side positions. The expanded position box is read automatically,
including its new Y maximum of 0.6547 m. Material values have been resampled;
coverage and the delivered region map are unchanged. The crown correction does
not affect these pieces.

The refreshed front, side, back and concept-size views retain the front/outward
plates, smaller ankle scales, dorsal toe plates and joint creases. All four claw
gradients still begin at station 0.95 and reach the worn tips near station 1.20.
Validation passed, and a clean rebuild from these corrected inputs again matched
all six delivered files byte for byte. Position and output comparisons are in
`checks/position_correction/`; the current rebuild hashes are in `checks/rebuild.json`.
