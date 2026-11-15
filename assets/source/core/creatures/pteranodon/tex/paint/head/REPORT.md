# Head — round 2: streak into nape

Accepted in round 3; the repository tidy preserves the painting calculations below. Reshaped the streak's rear end into a continuous turn down the occiput, joining the body painter's **15 mm profile-depth nape**. The accepted eye and anterior cheek band remain unchanged. The previous report is saved in [superseded/source/REPORT_before_feedback2.md](superseded/source/REPORT_before_feedback2.md).

The change is confined to the `head` piece behind **z = 0.52 m**. The rear band's inner edge eases into the turn over 80 mm, then follows a 15 mm inset perpendicular to the actual rear silhouette in the YZ plane. This replaces the broad, straight rear termination. The contour is recovered from the live head/neck position and normal bakes, with 2 mm sampling bins and a 0.5 mm resampling interval. A small smooth union rounds the inner corner by at most 3 mm. The existing face-fibre field keeps its approximately **2–4 mm interlocking fringe**; there is no added height ridge or painted shadow.

The join uses the body painter's updated [source/joins.json](../body/source/joins.json), including `nape.profile.depth_stations[0] = [0, 0.015]`. The old 70 mm width across the neck is not treated as a measurement of its visible profile. The shared rear midpoint is **(0, 1.35175, 0.40098) m**; representative dark and fringe samples are **(±0.03008, 1.34784, 0.41869)** and **(±0.03531, 1.34459, 0.42544)**. The head reads the live body maps, adopts its exact region tips within 1.5 mm of the cut, and interleaves them into the face over 4 mm. Coordination was through that live position contract; no direct agent-messaging channel was available.

All **1,608** nearest head/neck pairs within **1.5 mm** agree on their region. Their mean base difference is **0.003823 linear**, mean height difference **0.000317 mm**, roughness difference **0.001571**, and occlusion difference zero. These are nearby surface samples, not coincident vertices. The body painter's delivered-map measurement immediately behind the head is **15.41 mm equivalent solid-band depth**, about 28 mm down the silhouette from the top ring; that is a separate downstream measurement, not a claimed measurement at the cut itself.

The delivered region map changes **4,775 head texels**: 4,750 become ivory as the inner edge rounds into the narrower descending ribbon, and 25 become charcoal at the updated join. All changes are between ivory and charcoal, behind z = 0.52 m. The **beak, jaw, crest and eye** are byte-identical in every layer. The head's complete **height, roughness and occlusion maps** are byte-identical. Base colour differs only at **25 join texels**, by at most two 8-bit levels, where the live body changes their category and therefore the accepted material calibration. All other base texels are unchanged. The amber iris, pupil, lid ring, horn grain, nostril, gape, crest band and mouth are preserved.

Coverage remains **1,141,951 owned texels**, with no missing or unowned paint. The five maps remain 2048 square; height is genuine 16-bit over 1.8 mm, regions are categorical, and dyed base RGB channels are equal. Final linear means are **0.500931 / 0.499934 / 0.502059 / 0.499675** for regions 0 / 2 / 3 / 5. The eye streak still measures **29.69 mm** through the central 90% of its delivered dark texels; the accepted anterior rear-cheek section at z = 0.55 remains **43.58 mm**. Two builds with stable inputs reproduced all six delivery files byte for byte. The composer reported no grey warnings.

Reviewed the game's **head**, **head_front** and **rider** beside the concept, plus the side and front at **1000 px/m** and the enlarged occiput. The side now has a rounded inner turn and an uninterrupted dark connection down the nape. The rider sees the streak wrap into the central neck marking; the front retains the accepted eye, horn and ivory face. The comparisons include the body painter's concurrent neck revision.

- [Head comparison](superseded/checks/head_feedback2_comparison.png), [head_front comparison](superseded/checks/head_front_feedback2_comparison.png), [rider comparison](superseded/checks/rider_feedback2_detail.png).
- [Occiput at equal physical scale](superseded/checks/occiput_feedback2_detail.png), [full side comparison](superseded/checks/side_concept_comparison.png).
- [Scope and position checks](superseded/checks/feedback2_scope_and_join.json), [material and rebuild validation](superseded/checks/validation.json), [join measurements](superseded/checks/join_measurements.json), [final input hashes](superseded/checks/render_inputs.json).

These review artifacts are archived locally in ignored `superseded/`. The historical helpers are there too; the renderer source is retained as `render_details.ts.txt`.

```sh
python3 tex/paint/head/check.py
zsh tex/paint/look.sh tex/paint/head/checks/look --maps
python3 tex/paint/head/review.py
```

The model retains a sharper inward notch at the back of the head than the concept; the painted turn follows that existing silhouette. Its angular socket and crest root are unchanged. The 1024-square game RGBA maps merge the smallest fibre tips, and no form-occlusion bake is available. No layout or bake issue prevented this paint correction. All authored changes stayed in `tex/paint/head/`; no Blender, geometry changes or new generated images were used. This round took about **25 minutes**, including profile iterations, renderer comparisons and validation.

## Files

`paint.py` uses NumPy, Pillow and SciPy. It reads the authored `source/placement.json`, the shared `tex/paint/pteranodon_*` piece/position/texel maps, `ref/bakes/pteranodon_{regions,normal_object,flow}.png`, and the body's live `source/joins.json` and delivered `layers/`. It reads `study.json` and the accepted base/height/packed/regions layers directly from `tex/studies/horn/` (`horn`), `fuzz/` (`fuzz_face`) and `skin/` (`eye`, `mouth`), invoking the respective study's own `build.py` if a required delivery is missing. No study is edited or copied into this folder.

`source/` contains only `placement.json`; this painter needs no local generated originals and writes nothing back under `source/`. `layers/`, `checks/`, caches and `superseded/` are ignored. Old reports, checks and extra helpers are archived in `superseded/`, including `render_details.ts.txt`; no TypeScript files remain. `check.py`, `review.py`, the briefs, feedback and `artist_*.last.txt` remain with the build.

Two runs of `paint.py`, each starting without `layers/`, rebuilt all six delivery files byte for byte with stable live inputs ([SHA-256 verification](superseded/clean_rebuild.json)). The first clean run also matched the original accepted delivery exactly. Shared position/texel maps and body layers were subsequently regenerated outside this folder during the tidy, changing the inputs and output hashes; the final matching pair uses those refreshed inputs. The head's painting calculations and placement data are unchanged.

`check.py` and `review.py` passed against the refreshed inputs; their results are archived in [superseded/tidy_checks/](superseded/tidy_checks/).
