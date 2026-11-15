# Pteranodon body painting

Delivered the ten assigned pieces on `pteranodon`: torso (including tail), neck, leg, four toes and three small fingers. All authored files are in this folder. No Blender, external references, new generated originals, or edits to other painters' files were used.

[Game review](checks/review.png) · [rider](checks/look/rider_design.png) · [feet](checks/feet_dyes/feet_design.png) · [concept at matched scale](checks/concept_side_scale.png) · [source / base / relight](checks/source_base_relit.png)

## Construction and placement

`paint.py` reads the current piece IDs, position box, 16-bit positions, millimetres per texel, object normals and flow on every run. The current normal bake has positive X on this half while the newer position bake has negative X; the script resolves their handedness separately. It derives surface flow from the position Jacobian and the baked UV direction, rather than treating UV pixels as equally sized physical patches.

The source is the live **round 3 fuzz study**, including `fuzz`, `mantle_edge`, the element manifest and all aligned base/height/packed/region crops. Every element is checked against its parent layer at runtime. There is no frozen copy of an earlier study. Missing ignored study outputs are rebuilt by their own `build.py` in a private copy under this folder's `checks/rebuilt_studies/`, preserving other painters' directories.

The fuzz is sampled in overlapping surface frames on a shared 40 mm animal-space lattice. Frames follow the baked flow; cubic blend weights and source-variance compensation keep the fine value drawing without lattice seams. The same field spans torso, neck and leg, independent of the islands' atlas rotation. Absolute X preserves mirror symmetry. Two millimetres of gently reduced contrast at the back/belly meridians avoid a sharp reflected parting. The source is filtered for the actual body density before sampling; no noise-generated imitation fibres replace the study.

Body fibre calibration remains **6–12 mm**, with **12–30 mm locks**, sampled from the study's **500 mm** tile. Frames gradually reach half scale toward the head (y 1.14–1.32 m) and lower shin: **3–6 mm fibres**, **6–15 mm locks**. This matches the accepted face-scale morphology, which currently uses the same drawing at half the span and relief. The stub tail receives a restrained 2.5% pigment decrease near z −0.765 m, with no painted form shadow. The shoulders remain ordinary, unpressed fuzz beneath the separate saddle.

The mantle is a smooth, rounded saddle over the shoulders and back, tapering to the hips near z −0.675 m. Its half-width reaches roughly 158 mm over the shoulders and narrows to **22.5 mm** on the neck: **45 mm total**. Its edge directly samples the live `mantle_edge` categorical drawing, including wandering and interleaved dark/pale locks over approximately 1–2 cm. It does not inherit the stepped region guide. Region assignment and material sampling both use animal-space coordinates, including at the torso/neck cut.

The nape placement is recorded in [source/joins.json](source/joins.json): `abs(x) < 0.0225`, on the back side defined by `y - 0.84 > (z - 0.08) * 1.30`. It reaches the neck's upper end at the back of the skull. The head painter's current `source/placement.json` and script explicitly match this placement and sample the live body side within 4 mm of the join. The common height baseline is 0.4 mm, base 0.50 linear, dry roughness about 0.86.

On the lower leg, fuzz thins into horn skin over **28 mm**, centred at z −1.015 m. Material roughness and relief blend continuously; pure yellow/blue region IDs interleave along source-derived small tufts. This is material coverage, not transparent alpha.

Foot and toe layers come from the accepted skin study. Distance along each tube and its circumference are reconstructed from the live position bake. The `scutes` tile runs lengthwise along the toe, placing its **3–6 mm transverse plates** on the anatomical dorsal face. In the glide the toes curl toward +Y, so dorsal is −Y; the hand is oriented the other way. The sides and soles use the **0.5–1.5 mm pebbles** of `skin`. Both source tiles cover **200 mm**. Small fingers use **70%** of those feature sizes. Filtering lets subtexel pebbles settle into grain while the scutes remain legible.

Each claw uses the skin study's curved `claw` element and its recorded centreline, with longitudinal growth grain and the lighter, smoother worn point. Its colour remains natural dark brown-grey, region black, in every dye. The physical guide yields toe claw spans **35.9–44.6 mm** and small-hand spans **20.3–31.8 mm**. Collar placement follows the actual claw geometry/guide in longitudinal distance; it is not an arbitrary atlas rectangle.

## Delivered layers

The ignored `layers/` directory contains five 2048-square PNGs and `layers.json`:

| Layer | Contents |
|---|---|
| `pteranodon_base.png` | RGBA, exact alpha 255 on all assigned texels and 0 elsewhere. Neutral value drawing under dyes; naturally coloured claws. |
| `pteranodon_height.png` | Genuine 16-bit grey. Full encoding represents **0.8 mm**, recorded in `layers.json`. |
| `pteranodon_rough.png` | Dry fuzz, matte/satin pebbled skin and scutes, polished claw. |
| `pteranodon_occlusion.png` | Only the source materials' fine gaps and creases. No saddle or body-form shading. |
| `pteranodon_regions.png` | Pure red patterning, blue horn skin, yellow body and black undyed claw. |

No normal map is delivered: `compose.py` derives it from the quantized height at each texel's real scale. All non-owned texels are zero in every delivered layer. The body's occupied relief is **0.057 mm** on the torso and **0.052 mm** on the neck, **0.130 mm** over the leg's fuzz/skin transition, and **0.169–0.198 mm** across skin/claw pieces. This is shallow velvet and horn relief, not the length of exposed hairs. Fuzz roughness averages **0.859** and fine AO is **0.996–1.0**.

## Validation and visual review

Rebuild from the creature folder:

```sh
python3 tex/paint/body/paint.py
python3 tex/paint/body/check.py
zsh tex/paint/look.sh tex/paint/body/checks/look --maps
```

`check.py` validates the delivered files and makes the source/base/relight panel. [Validation](checks/validation.json), [build provenance](checks/build_metrics.json), and [reproducibility](checks/reproducibility.json) record the results and SHA-256 hashes.

- **1,126,308 / 1,126,308** assigned texels covered; **zero** unpainted or outside-owned texels.
- Exact R=G=B in every dyed texel; no illegal region colours.
- Linear means: pattern **0.500004**, horn skin **0.500001**, body **0.500001**. The composer reports x1.000 correction for these regions.
- Fuzz along-flow / cross-flow gradient energy: torso **0.140**, neck **0.133**, leg **0.236**. The stronger transverse gradients confirm that the visible strands follow the flow.
- At 673 nearby samples across the torso/neck cut, mean height difference is **0.0047 mm**, mean linear value difference **0.0236**, and region agreement **97.6%**. These compare neighbours up to 2.5 mm apart, rather than identical points; local fringe differences are expected. The rendered cut is not visible.
- A second complete run with unchanged input hashes reproduced **all six delivery files byte for byte**.

The game's own renderer was used first to judge the result. I inspected `above_design`, `side_design`, `three_quarter_design`, the rider in design/loud/dark dyes, the feet in all three dyes, and the four distance views. The top view has a clean dark saddle shape with a soft margin; the rider sees the nape line continuing into the head. The pale body remains distinct below at 60 m. Scutes read across the feet; the finer skin and pile quiet down with distance. The bright/pale mantle in the dark dye variant exposes the pile particularly clearly. The source/base/relight comparison filters both source references to the body's actual density before enlargement, so it does not compare native 4096 px/m source fibres against a 1056 px/m mapped crop unfairly.

`checks/feet_dyes/` adds the game's feet view for loud and dark dyes, which the standard look script omits. Its generated local runner uses the same game shader, camera, lights and map importer. Review renders use the current head and wing painters' layers; those portions are not this delivery.

## Remaining limits

The current cached model shows visible **gaps between the ankle/foot mesh and the toe roots**, angular tapering claws, and angular joins near the wing roots. The position bake also makes each full toe island roughly **200–230 mm** from its attachment-cap end to its tip, longer than the brief's approximately 100 mm fleshy toe plus claw. The toe/claw material is sampled in physical metres, not stretched to hide this geometry. These mesh issues require modelling changes; this painter changed no geometry.

The composer reports **no form-occlusion bake yet**. These maps deliberately supply only fine material occlusion. Material maps cannot add silhouette fuzz. At the renderer's 1024-square rgba maps, individual submillimetre pebbles and the finest velvet filaments are below resolution; the source drawing survives as directional grain. Dark dyes suppress more of it. The concept retains broader hand-painted strokes than the accepted photographic velvet study. The torso/leg boundary has no pairs within the 2.5 mm boundary-sample threshold, so that join is assessed visually, not claimed as a numerical seam pass.

The final build took 24 seconds when the machine was less busy, and the determinism rebuild 50 seconds while other work rendered. The work included instruction/source review, implementation, three body builds, game/dye review and validation; wall time was roughly half an hour.
