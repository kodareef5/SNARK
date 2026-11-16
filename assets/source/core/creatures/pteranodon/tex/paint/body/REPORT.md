# Body round 4 — the extended foot band

The orange leg/foot band now samples the accepted skin study in **animal-space metres**, using the current position, normal and texel-size maps. Transverse scutes cover its dorsal face; the sides and back use the fine pebbled skin. The shin's original fuzz contribution and categorical fringe remain in place. **Every layer texel outside the existing orange leg band is unchanged.** Both clean rebuilds reproduce all six delivery files byte for byte.

The visual result has a remaining limit: the pinned, stretched faces cannot resolve all the requested 3–6 mm scutes. The normal game's 1024 preview still makes much of the distal band look smooth. The dorsal diagnostic at 2048 shows more of the correctly scaled detail, but does not resolve every plate either. This is not a claim that the entire sleeve now reads as individual scutes in `feet`.

[Final feet](checks/round4_look/feet_design.png) · [Final three quarter](checks/round4_look/three_quarter_design.png) · [Before / after crop](checks/round4_feet_comparison.png) · [Dorsal, normal preview](checks/round4_look/foot_dorsal_design.png) · [Dorsal, source-resolution diagnostic](checks/round4_full/foot_dorsal_design.png) · [Back](checks/round4_look/foot_back_design.png)

## Mapping and drawing

`paint.py` first runs the accepted painter unchanged, including its whole-body value calibration. It then replaces only the skin contribution where the current leg piece has the existing orange region ID. That mask contains **20,890 texels**, including the orange tips within the ankle transition. All yellow fuzz texels, every region ID, the toes, claws, hands, torso and neck retain their previous bytes. The replacement preserves the old fuzz blending weight and subtracts the old skin contribution before adding the new one.

The foot's long axis is fitted to the live position map with surface-area weights from `pteranodon_texel_mm.png`. Complete cross-sections at 4 mm intervals establish its centre and elliptical circumference. Longitudinal distance is a projection in metres; transverse distance is elliptical arc length in metres. The plate direction follows the foot, with front coverage selected by the actual surface normal. Atlas row count and the former 2 cm length do not set its drawing scale.

The live `skin` and `scutes` deliveries retain their **200 mm tile span**, at scale 1: the study's nominal **3–6 mm transverse scutes** and **0.5–1.5 mm pebbles**. The scute field reaches the foot's distal end; the toe painting itself is unchanged. These are the study's feature calibrations, not a claim that each filtered crease is separately measurable in the final preview.

Each target texel integrates an 8 × 8 set of samples over its position-derived footprint. A local source prefilter and the texel-size map prevent unresolved detail from turning into large false stripes. All four material channels use the same samples. The retained pigment/crease drawing receives a **2× value-contrast gain**, with a local zero-mean correction. Relief is sampled at its original physical amplitude. No new image originals, procedural replacement scales, geometry, layout or shared-map edits were made. No Blender process was run.

| Layer | Construction and result |
|---|---|
| Base | Accepted study value drawing; neutral RGB; band-local contrast and mean correction after the old global calibration |
| Height | Accepted skin/scute relief, preserving the old physical baseline and fuzz contribution; **0.167825 mm** occupied range in the band |
| Roughness | Aligned study roughness; band mean **0.66236** |
| Fine occlusion | Aligned study occlusion only; band mean **0.99064**, minimum **0.95686** |
| Regions | Entire file byte-identical to the pre-edit delivery |
| `layers.json` | Unchanged: full 16-bit height range encodes **0.8 mm** |

Final dyed linear means: pattern **0.500118**, horn skin **0.499996**, body **0.499971**. The new band changes no other region's calibration. [Material measurements](checks/round4_material_metrics.json) · [Input and output hashes / mapping metrics](checks/build_metrics.json).

## Preservation and rebuild

The baseline is the user's already-rebuilt delivery from the new model, saved before editing in `checks/round4_before/`. `review_foot.py` compares decoded texels against that baseline and asserts that every change lies inside the pre-existing orange leg mask.

| Delivered layer | Changed texels | Changed outside band |
|---|---:|---:|
| Base | 19,707 | **0** |
| Height | 20,876 | **0** |
| Roughness | 18,405 | **0** |
| Occlusion | 14,173 | **0** |
| Regions | **0** | **0** |

`check.py` passes: **1,126,308 / 1,126,308** owned texels covered, zero outside-owned texels, neutral dyed base, valid pure region colours, valid 16-bit height and unchanged nape-core checks. The comparison above is against the current model, rather than the historical round-2 geometry.

Two complete runs starting with **no `layers/` directory** took **23.82 s** and **23.44 s**. SHA-256 matched all six delivery files on both runs. The painter reads live studies and bakes; it never reads the review baseline, old outputs or `superseded/`.

[Strict scope and clean-rebuild audit](checks/round4_verification.json) · [Body validation](checks/validation.json).

From the creature folder:

```sh
python3 tex/paint/body/paint.py
python3 tex/paint/body/check.py
python3 tex/paint/body/review_foot.py --baseline tex/paint/body/checks/round4_before --rebuild
zsh tex/paint/look.sh tex/paint/body/checks/round4_look --maps
```

The third command needs the preserved pre-edit review baseline; the ordinary paint and check commands do not. `review_foot.ts.txt` retains the extra game-camera review, including the explicitly labelled source-resolution diagnostic. Work from the baseline snapshot through final review took approximately **14 minutes**, including diagnostic renders. Earlier report/history is preserved with the review baseline in `checks/round4_before/REPORT.md`.

## Renderer review and the remaining density limit

Inspected the final **`feet` and `three_quarter`** views in the game's renderer, plus dorsal and back close-ups and the loud-dye feet. The ankle has finer transverse/pebbled drawing, its fuzz edge remains intact, and the toe and claw treatment remains unchanged. At three-quarter distance the foot keeps its clean orange read. The back is matte and finely grained where density permits.

On the elongated faces, the area-equivalent footprint is **1.636–3.059 mm per texel** (median **2.107 mm**). More importantly, the position derivatives reach **5.910 mm along the foot per source texel**. The normal review downsamples those maps from 2048 to 1024, reducing the available longitudinal samples again. Many 3–6 mm scutes therefore occupy less than a texel; the 0.5–1.5 mm pebbles disappear sooner. The filtered distal band remains too quiet in the ordinary `feet` view, even with stronger source value drawing. A render with the same game shader and full 2048 source mips confirms that this is also a source-density constraint, not only the preview's mip choice.

The physical mapping fixes the former atlas-dependent stretching, but fully readable scutes over that entire ring would require more longitudinal texture samples or a material-detail mechanism beyond these pinned layers. Those changes are outside this round's explicit constraints. The delivered maps retain the requested physical scale and do not substitute oversized scales or aliased bands to conceal the limit.
