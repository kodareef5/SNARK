# Sky style-sheet report

Completed the first style package in this folder. The proposed hand is **Limestone / Lagoon / Ember**: mineral-blue air, pale celadon haze, warm chalky stone, a narrow apricot-to-copper sunward seam, and a restrained rose return over the earth shadow.

## Deliverables

- [style/sheet.png](style/sheet.png): eight hours toward the active light, 2136 × 2524, with eight 1024 × 512 painted panels.
- [style/away.png](style/away.png): the matching eight hours away from the active light, same dimensions and panel layout.
- [style/STYLE.md](style/STYLE.md): the hand, all eight requested colour samples per hour, exposure readings, sampling method, and transfer guidance.
- [style/golden-hour-study.png](style/golden-hour-study.png): a separately generated larger painting, exported at 2048 × 1024.
- [style/palette.png](style/palette.png), [palette.csv](style/palette.csv), and [palette.json](style/palette.json): visual and machine-readable samples.
- `style/panels/toward/` and `style/panels/away/`: all sixteen clean 2:1 panel crops.
- `originals/`: all three image-tool source images, unchanged. [Source manifest](reports/sources.json) records native dimensions and SHA-256 hashes. [prompts.md](prompts.md) retains every generation prompt.
- `reports/`: sample coordinates, marked-up inspection sheets, verification, and work-session metadata. `scripts/`: the reproducible build, verification, and notes/export scripts.

## How it was made

I used the built-in image-generation tool. The only starting image was the supplied game render of the limestone and timber building. The first call painted all eight sunward hours together to establish one hand and one geography. The second used that painting and the supplied render to make the reverse view. The third expanded golden hour as a larger hand study. No sky photographs, other games, web images, API fallback, or outside visual assets were used.

The tool returned two 1254 × 1254 grids and one 1774 × 887 larger painting. These are kept untouched in `originals/`. The clean grid panels are roughly 627 × 313/314 natively; the delivered 1024 × 512 panels are Lanczos-resampled. The larger study is also modestly enlarged to 2048 × 1024. These dimensions are not claims of native generated detail.

Local Python work split the grids, graded the land in linear RGB against both painted cards, graded the sky with vertical colour controls and feathered silhouette masks, and preserved the water's source hue while scaling its value with the horizon. The noon sun was moved down in the upper-sky mapping to the 66° guide, with its disc kept round. Emitting discs retain their source colour. Noon cloud highlights received a small correction to prevent a sky-blue adjustment from making them pink. Captions and numerical material were added outside the paintings.

## Measurement and review

All 80 recorded RGB samples were re-read from the **final presentation PNGs** and checked against their data records. Of these, 32 are card readings: two cards in each of sixteen panels. Largest card error: **0.38 sRGB levels** relative to the brief, using linear-light luminance converted back to neutral sRGB. The noon sky at the away 30° guide is **(150, 190, 230)** exactly. The larger study's cards read **63.70 / 54.92**, within 0.31 of **64 / 55**.

All eight keys have brighter sampled horizons than sampled zeniths, in both directions. All eight sampled cloud lights are brighter than the corresponding shaded edges. The exports carry an sRGB profile. [Verification results](reports/verification.json) and [exact sample coordinates](reports/samples.json) make the checks repeatable.

I inspected both generated grids, the generated larger study, the assembled sheets, enlarged cloud regions, the graded larger painting, and the final images. The first grading pass met the numbers but pushed the water and limestone too orange; I rejected that grade and reduced the card tint while separating the water treatment. The later passes refined the cloud samples, noon cloud colour and disc colour preservation.

## Rounds and time

**Three image-generation calls**, one for each source painting; no failed or discarded generation calls. **Four local grading/review passes**. The image-tool calls took about 42, 35 and 22 seconds respectively as reported by the tool; the remaining time went to prompts, inspection, grading, sampling and the handoff.

Started **2026-11-14 23:27:34 UTC**; package notes written **2026-11-14 23:46:10 UTC**. Elapsed to this report: **18 minutes 36 seconds**. Exact session metadata is in [reports/session.json](reports/session.json).

## Where it falls short

1. **This is a style sheet, not the final scene paintover or a proven physical-LUT fit.** The coast is invented. The actual renderer, camera, albedo and atmosphere still need to demonstrate these colours at the locked exposure. A few measured anchors cannot prove the full dome is physically realizable.
2. **Geometry is consistent by eye, not registered.** Masonry joints, leaves and the shoreline drift slightly across generated panels; the reverse view is an artistic companion rather than a surveyed 180° turn. The final proving-ground render should lock all of this.
3. **Angular placement is illustrative.** The painted elevation guide compresses a large span of sky into a wide panel; it is not a rectilinear camera. The noon correction improves its height, but the other sun placements can still be a few degrees off the labels. Discs and halos are oversized for legibility, and dawn's disc sits closer to the rim than I would keep in the exact final key. Night follows the moon as the active light; the sun is opposite and below the horizon.
4. **The hand is still too regular in parts of the sky.** Some diagonal brush texture repeats, the cloud ribbons are similar from hour to hour, and fine native detail is limited. The larger painting improves the scale test but remains an enlarged generated source, not a fully hand-finished native 2K painting.
5. **Cloud and shadow evidence is simplified.** The ribbons have shallow translucent undersides, not fully resolved cloud volumes. The shaded cards' placement does not prove physically correct penumbrae or sky occlusion. The hand-traced grade masks can leave small edge transitions around foliage and shore.
6. **Night is deliberately subdued.** Broad forms remain readable at the requested 36/21 card values, but small jungle detail will be lost on a dim display. I would review it in the game at normal display brightness before approving the final key.

Rebuild from this folder with `python3 scripts/build_style.py`, then `python3 scripts/verify_style.py`, then `python3 scripts/write_notes.py`. The last command refreshes the report timestamp. All project writes are inside this folder; the image tool's automatic staging files were copied here without modifying the supplied reference.


# Round 2: The eight registered mood keys

Delivered all eight **2048 × 1024 RGB sRGB** panoramas in this folder: [dawn](dawn.png), [morning](morning.png), [noon](noon.png), [afternoon](afternoon.png), [golden](golden.png), [sunset](sunset.png), [dusk](dusk.png), [night](night.png). [keys-sheet.png](keys-sheet.png) shows the complete day. [The player-view sheet](views/sheet.png) shows the sixteen **1280 × 720 JPEG** views in [views/](views/): 100° horizontal field of view, pitch +10°, toward and opposite each active light. Camera definitions are in [views/cameras.json](views/cameras.json).

## How these keys were made

The built-in image tool painted each hour separately using that hour’s physical underlay as the edit target and our own style sheet as the hand/palette reference. No external images or photographs were used. Eight untouched **1774 × 887** source paintings are retained as `originals/04-dawn-panorama.png` through `originals/11-night-panorama.png`; their hashes, dimensions and celestial construction records are in [reports/key-build.json](reports/key-build.json). All eight exact prompts are appended in [prompts.md](prompts.md). The final 2048-pixel panoramas therefore include enlarged generated paint, not native 2K generated detail.

The supplied `physical.py` was run unchanged to refresh the underlays. They were hidden by the initial ignored-file listing, not actually missing. Their colour relations and the original style established the initial target palette. I measured the source paintings, explored fits with the supplied grade model, and chose the final controls recorded in [reports/palette-decisions.json](reports/palette-decisions.json).

`scripts/build_keys.py` restores the complete land from the original base pixels. No terrain, cube, tree, checker, coastline or sea boundary is resampled or moved, and no generated land is retained. The existing material colours receive blue ambient and warm direct-light gains. Complete connected grey faces receive the corresponding light colours; the flat card is calibrated over its whole visible face, not just its sampled square. At sunset and dusk the original top and side share one grey, so the card slab’s lower side is shaded separately inside its original silhouette. This is an artist’s relight, not a recovered-normal physical render.

For the sky, the source paintings supply the broad colour fields and thin cloud filaments. Smooth whole-dome colour corrections span elevations and a broad periodic sunward lobe. There are no sample-sized colour patches. A stronger honey/apricot veil spreads across golden hour’s sunward quarter; a blue atmospheric shadow sits beneath the dusk/sunset rose return. Cloud detail fades out before every 4° exclusion region, with no cloud above the polar cap. Original generated discs are removed; angular spherical discs replace them at the supplied headings and elevations: sun **1.2°**, moon **1.5°**. The projection itself widens the high discs. Dusk and night use a sparse, deterministic spherical star catalogue. Sea reflection uses the painted sky, with marine body colour retained. Existing mixed edge pixels are recoloured using their source blend weights.

The cylindrical sky join is continuous and the first row is a single zenith colour. Rectilinear player views are sampled from the final panoramas using the supplied north/east convention, not cropped or independently generated. I inspected both complete contact sheets and enlarged dawn, golden, sunset, dusk and night views. Noon’s sun and the high night moon are correctly above the top of the prescribed +10° player cameras; they remain visible in their panoramas.

## The points read

[scripts/read_points.py](scripts/read_points.py) independently reads the arithmetic mean of each **13 × 13** square at the supplied integer x/y, wrapping horizontally. It writes [points.json](points.json) and [reports/key-points.csv](reports/key-points.csv). The table below rounds those final-pixel readings to whole sRGB levels; JSON retains three decimals. `Z / H / T / A` mean near zenith / 30° away / 3° toward / 3° away.

| Key | Z | H | T | A | Lit face | Shaded face | Up card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| dawn | (108, 155, 214) | (174, 203, 237) | (248, 223, 202) | (231, 214, 215) | (138, 105, 83) | (31, 43, 63) | (52, 59, 73) |
| morning | (53, 112, 182) | (117, 165, 214) | (233, 226, 202) | (209, 231, 227) | (157, 142, 117) | (54, 71, 94) | (95, 91, 82) |
| noon | (80, 147, 212) | (140, 183, 228) | (224, 238, 230) | (216, 235, 234) | (108, 104, 93) | (54, 71, 95) | (127, 123, 114) |
| afternoon | (81, 126, 183) | (143, 175, 212) | (237, 218, 190) | (222, 219, 211) | (149, 132, 109) | (53, 71, 96) | (119, 110, 97) |
| golden | (89, 116, 160) | (139, 155, 189) | (249, 187, 115) | (206, 184, 180) | (157, 112, 65) | (40, 55, 81) | (76, 62, 46) |
| sunset | (64, 73, 110) | (124, 116, 149) | (224, 147, 118) | (169, 135, 155) | (100, 60, 45) | (23, 32, 51) | (58, 45, 45) |
| dusk | (49, 66, 124) | (72, 97, 159) | (227, 154, 110) | (131, 118, 154) | (53, 50, 65) | (19, 26, 43) | (31, 35, 49) |
| night | (12, 24, 44) | (24, 44, 75) | (54, 79, 116) | (49, 73, 109) | (26, 32, 42) | (13, 21, 35) | (30, 36, 47) |

## Supplied measure and verification

Ran **`python3 -I measure.py`**, unchanged, on the final keys. All eight pass the requested maximum of 6, and all eight `notes` arrays are empty. Full point distances and fitted tint/saturation/horizon/glow parameters are in [points-read.json](points-read.json). Distances below are OKLab × 100. Card brightness is the neutral sRGB equivalent of linear-light luminance, compared with `underlay/points.json`’s `lowPolyUp`.

| Key | From physical: Z / H / T / A | afterBestGrade | Card brightness | lowPolyUp | Error |
| --- | --- | ---: | ---: | ---: | ---: |
| dawn | 4.9 / 4.1 / 1.1 / 6.3 | **3.2** | 58.76 | 58.5 | +0.26 |
| morning | 16.1 / 9.6 / 8.2 / 6.9 | **3.7** | 91.26 | 91.0 | +0.26 |
| noon | 11.0 / 5.0 / 4.8 / 3.9 | **5.4** | 123.25 | 123.3 | -0.05 |
| afternoon | 12.7 / 5.2 / 8.8 / 6.4 | **5.3** | 111.13 | 110.8 | +0.33 |
| golden | 5.8 / 11.6 / 15.3 / 18.5 | **4.0** | 64.33 | 64.1 | +0.23 |
| sunset | 19.4 / 26.9 / 17.2 / 18.4 | **5.0** | 48.09 | 48.5 | -0.41 |
| dusk | 10.8 / 7.9 / 21.9 / 14.6 | **4.7** | 35.41 | 35.6 | -0.18 |
| night | 13.6 / 5.5 / 14.2 / 15.3 | **3.9** | 35.75 | 35.6 | +0.15 |

Largest final grade error: **5.4**. Largest card brightness error: **0.412** levels. All 56 independent samples match the supplied reader to its 0.1-level rounding. The zenith row is exactly uniform in each key; the maximum opposite-edge sky difference is **1** RGB level. The recorded cloud-detail masks have **zero** pixels within 4° of all four sky points. [Verification record](reports/keys-verification.json).

## Choices made to keep the mood attainable

- **Dawn:** its zenith is now approximately (108, 155, 214), replacing the style sheet’s (54, 78, 123). Pearl/peach is low, while terrain stays in cool shade. The physically plausible grazing cube face is warmer than the flat card.
- **Noon:** the largest compromise. The supplied physical points have a near-zenith sky slightly brighter than the away 30° sky. The original very dark ceiling with a bright 30° guide could not pass this six-parameter fit. I lifted the mineral-blue ceiling to (80, 147, 212) and kept the high sky near (140, 183, 228). The latter’s neutral brightness is slightly below the brief’s (150, 190, 230) reference. The pearl horizon and saturated tropical-blue family remain, but the overhead contrast is gentler than the approved style sheet.
- **Golden:** the source’s orange was softened into honey/apricot; warmth fills the sunward quarter rather than a thin rim. Its catching grey face is (157, 112, 65), against blue shade (40, 55, 81), with the flat card held to 64.1 brightness.
- **Sunset:** an uncorrected source fit of 8.7 required less saturated copper and a lighter, blue ceiling. Violet/rose stays low and opposite the sun. The final fit is 5.0.
- **Dusk:** the uncorrected painting fit at 8.1. I moderated the strongest copper and balanced the clear blue against the rose return. The final blue ceiling is (49, 66, 124), distinctly brighter than night’s (12, 24, 44); the broad gold–green-blue afterglow remains. The final fit is 4.7.

## Rounds and elapsed time

**One generation pass: eight image-tool calls. Three completed assembly/review passes:** first registration and grade, second water/dawn/earth-shadow refinement, third source anti-alias boundary cleanup. An initial partial build stopped at a NumPy casting error and was fixed. Numeric candidate searches were used to choose noon’s compromise before the first full assembly. The first assembled set already met the numerical limit; later passes addressed the player views. [First-pass comparison files](reports/round-1/).

Recorded start **2026-11-14 23:47:38 UTC**; report written **2026-11-15 00:11:10 UTC**. Elapsed: **23 minutes 33 seconds**. The four image-call groups took approximately 20.6, 52.9, 44.4 and 64.5 seconds of wall time; each group contained 1, 2, 2 and 3 calls respectively. [Session record](reports/keys-session.json).

## Where it falls short

1. **The supplied sea line and angular horizon disagree.** Around the sunset sun’s column, flat sky continues through row 517 and the original sea transition begins at 518; the supplied zero-degree sun centre is near row 512. I preserved the exact celestial coordinates and unchanged sea silhouette. Consequently the sunset disc sits slightly above the raster sea edge instead of being exactly bisected by it. Moving either would violate another explicit constraint.
2. **Noon is less deep overhead than the approved style sheet.** This is the main cost of the provided physical grade fit; its cooler mineral character survives, but the more dramatic ceiling does not. Sunset’s copper is also quieter than the raw source painting.
3. **A four-point grade fit does not prove the whole sky can be reproduced by the runtime table.** Clouds, discs, stars and the broad intermediate twilight gradients need the actual engine’s full-dome review. The verified claim is the supplied measure at all requested points, not an unperformed LUT render comparison.
4. **The ground remains the plain proving ground.** Its checker and low-poly colour edges can distract, and the relight is an image-based material/face treatment rather than a full surface-normal and visibility solve. The original geometry stays exact. The calm sea is deliberately simple, without invented waves or scenery.
5. **The sky hand is restrained and smoother than a full concept painting.** Robust clearing near measurement regions and source-disc removal reduce some brush character. Source paint is enlarged from 1774 × 887. Night forms remain readable at the specified exposure, but fine ground detail is subtle on dim displays.

Rebuild the delivered package from the retained originals and final palette controls:

```sh
python3 -I scripts/build_keys.py
python3 -I scripts/read_points.py
python3 -I measure.py
python3 -I scripts/verify_keys.py
python3 -I scripts/report_keys.py
```

The exploratory `probe_sources.py` and `choose_palette.py` write source/candidate analysis; they are not required for the final rebuild. `physical.py`, `measure.py`, `base/`, and the first-round style package were not edited. All project outputs were written inside this folder.


# Round 3: Mineral ceiling, reflected light, clean silhouettes

Revised all eight registered keys and refreshed [keys-sheet.png](keys-sheet.png), the sixteen 100° × 16:9 player views in [views/](views/), [their sheet](views/sheet.png), [points.json](points.json), and [points-read.json](points-read.json). Every key is still **2048 × 1024 RGB sRGB**. All eight pass the revised, unmodified measure; the worst `afterBestGrade` is **5.8**.

The untouched round-two keys, sheets, views, point records, report, prompts, and scripts are in [rounds/round-2/](rounds/round-2/). Its [SHA-256 manifest](rounds/round-2/manifest.json) covers 70 files and is checked by the verifier. The copied measure is the owner’s revised version that was present at the start of this round.

## What changed and why

1. **The deep noon ceiling is back.** The revised measure first confirmed the existing noon at 3.4. The delivered near-zenith colour is now **(29, 86, 161)**, matching the original style sheet’s mineral blue instead of round two’s (80, 147, 212). Morning, noon, and afternoon now read approximately **(110, 194, 254)** at 30° away. That is the requested saturated hue lifted to the brightness reference: neutral-equivalent levels **185.81 / 185.71 / 185.99**, against **185.87** for (150, 190, 230). Literal (105, 185, 245) is darker than that reference. Morning’s ceiling received a small value lift to retain fit margin with the brighter high sky; afternoon’s ceiling is clearer and more saturated.

2. **Afternoon’s light is gold-white.** One built-in image-tool edit used only our existing afternoon panorama as its input. The untouched result is [originals/12-afternoon-round-3.png](originals/12-afternoon-round-3.png); the exact prompt is appended in [prompts.md](prompts.md). The build blends 65% of its smooth air field with 35% of the earlier source, retains the earlier cloud filaments, and adds a soft angular gold-white veil in linear light. The first assembly was too peach-coloured around the sun; the second softened it into gold-white. The low sunward sample is now approximately (248, 231, 198), with clear blue above. No generated terrain or celestial placement is used.

3. **Low-hour water carries the sky.** Dawn, golden, sunset, and dusk use the sky reflected at the same heading and opposite elevation. Reflection approaches full strength at grazing angles; a mild compression of the Fresnel value curve keeps the painter’s sea luminous farther below the horizon. This is an art grade of a reflection, not an unmodified dielectric BRDF. The warm side receives pearl, honey, copper, or afterglow; the opposite side receives its cooler blue and rose. Fine solar glints sit at the exact sun heading and remain clipped by the original water mask. Dawn’s direct path is largely hidden by the ridge. Dusk has no solar glitter because the sun is below the horizon. Morning, noon, afternoon, and night retain **every solid water pixel** from round two.

4. **Night is readable through the sky.** It now measures about **(21, 37, 69)** overhead, **(62, 91, 131)** at the moonward horizon, and **(60, 90, 130)** opposite. The halo combines a soft 5.8° Gaussian core with a quieter 12° skirt, replacing the earlier 2.2° glow. The moon’s 1.5° disc, position, and sparse star catalogue are unchanged. Solid ground and all complete grey faces are unchanged.

5. **The horizon defects were repaired at their source.** The vertical streaks came from copying row 530 into the sea/sky transition: where row 530 contained a tree or slope, that land colour was carried upward. The new compositor uses a local water field directly. It also recognizes the small non-flat water mixtures between ridge tops and sky. At terrain, tree, cube, and water boundaries, it recovers the existing blend coverage from the original base colours and nearby foreground material, allowing a foreground brightness difference where the slope/checker changes. It then recomposites that same pixel against the corrected sky or sea. No silhouette is shifted, dilated, or resampled. This removes the old water-coloured fringe without repainting the solid terrain.

**Sunset uses the remaining room.** Its sunward point is now (239, 150, 110), up from (224, 147, 118): a hotter copper-orange rim, carried into the sea, while the dusky-blue ceiling and opposite rose/violet stay. More aggressive copper candidates exceeded 6, so this version stops at a measured 5.8.

## What was preserved and inspected

The verifier compares the delivered images directly with the archive. All solid land pixels and the entire connected lit, shaded, and face-up grey surfaces are byte-identical. The pure sky of **dawn, golden, and dusk is byte-identical**, including the pearl dawn, honeyed quarter, afterglow, clouds, and rising dusk moon. The sun/moon construction records and star coordinates are identical across every key. Boundary pixels containing mixed sky or water are the explicit exception to pixel preservation, because their old background contribution was the artifact being removed.

I inspected all eight full panoramas at native resolution, all eight complete horizon strips at 100%, the enlarged reported golden-hour trouble area, and both player-view contact sheets. The final native horizon crops and the before/after strip sheet are in [reports/round-3-review/](reports/round-3-review/). The two vertical streak regions and the continuous blue ridge fringe are cleared. Remaining small dark silhouettes are the source terrain and vegetation.

## Final readings

These are rounded means of the actual 13 × 13 pixel patches, independently read by `scripts/read_points.py`. Z / H / T / A mean near zenith / 30° away / 3° toward / 3° away; JSON retains three decimals.

| Key | Z | H | T | A | Lit face | Shaded face | Up card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| dawn | (108, 155, 214) | (174, 203, 237) | (248, 223, 202) | (231, 214, 215) | (138, 105, 83) | (31, 43, 63) | (52, 59, 73) |
| morning | (50, 118, 192) | (110, 194, 254) | (233, 226, 202) | (209, 231, 227) | (157, 142, 117) | (54, 71, 94) | (95, 91, 82) |
| noon | (29, 86, 161) | (110, 194, 254) | (224, 238, 230) | (216, 235, 234) | (108, 104, 93) | (54, 71, 95) | (127, 123, 114) |
| afternoon | (57, 133, 206) | (110, 194, 254) | (248, 231, 198) | (222, 219, 211) | (149, 132, 109) | (53, 71, 96) | (119, 110, 97) |
| golden | (89, 116, 160) | (139, 155, 189) | (249, 187, 115) | (206, 184, 180) | (157, 112, 65) | (40, 55, 81) | (76, 62, 46) |
| sunset | (64, 73, 110) | (124, 116, 149) | (239, 150, 110) | (169, 135, 155) | (100, 60, 45) | (23, 32, 51) | (58, 45, 45) |
| dusk | (49, 66, 124) | (72, 97, 159) | (227, 154, 110) | (131, 118, 154) | (53, 50, 65) | (19, 26, 43) | (31, 35, 49) |
| night | (21, 37, 69) | (36, 59, 99) | (62, 91, 131) | (60, 90, 130) | (26, 32, 42) | (13, 21, 35) | (30, 36, 47) |

| Key | Revised afterBestGrade | Card brightness | lowPolyUp | Card error |
| --- | ---: | ---: | ---: | ---: |
| dawn | **3.1** | 58.76 | 58.5 | +0.260 |
| morning | **5.5** | 91.26 | 91.0 | +0.261 |
| noon | **5.1** | 123.25 | 123.3 | -0.053 |
| afternoon | **5.4** | 111.13 | 110.8 | +0.334 |
| golden | **4.1** | 64.33 | 64.1 | +0.229 |
| sunset | **5.8** | 48.09 | 48.5 | -0.412 |
| dusk | **4.7** | 35.41 | 35.6 | -0.185 |
| night | **1.6** | 35.75 | 35.6 | +0.149 |

All supplied-reader notes are empty. Largest card error: **0.412 levels**, unchanged from round two. Maximum sky edge difference: **1 level**. Each zenith row is exactly uniform. All cloud exclusion counts remain zero within 4° of the four sky points. All 56 independent readings agree with the supplied reader to rounding. Full preservation and acceptance results are in [reports/keys-verification.json](reports/keys-verification.json).

## Rounds, time, and remaining limits

**One image-tool call and two completed assembly/review passes.** The first restored colour and reflection; the second refined the mixed edge treatment, water value, and afternoon warmth. The recorded clock starts with the archive at **2026-11-15T00:15:10.621890+00:00**, after reading the briefs and report, and ends at **2026-11-15 00:28:26 UTC**: **13 minutes 16 seconds**. [Session and source hash](reports/round-3-session.json).

- The supplied angular horizon and raster sea edge still differ by roughly seven rows. Both original registrations are preserved, so the sunset disc remains slightly above the raster sea line.
- The fit proves the requested four sky samples, not an unperformed full-dome runtime LUT comparison. Sunset has only 0.2 of reported fit margin.
- Mixed boundary coverage is inferred from flattened RGB base renders, rather than supplied by a renderer alpha pass. The native inspection crops make this treatment reviewable.
- The new afternoon source is 1774 × 887 and is enlarged for its smooth colour field. The retained cloud hand and procedural glitter are deliberately restrained; these are mood keys, not a detailed water simulation.

## Rebuild this round

Keep `rounds/round-2/`: it is the immutable source for the preserved foreground. The build also uses the existing originals, base renders, and palette controls. `report_keys.py` now dispatches to the round-three report writer, preserving the two historical report sections.

```sh
python3 -I scripts/build_keys.py
python3 -I scripts/read_points.py
python3 -I measure.py
python3 -I scripts/verify_keys.py
python3 -I scripts/report_keys.py
```

`physical.py`, the revised `measure.py`, `base/`, `underlay/`, and the original style package were not edited. The new surface work is in [scripts/round3_surfaces.py](scripts/round3_surfaces.py). All project writes are in this folder; the image tool’s staged result was copied here unchanged.


# Round 4

The eight final panoramas, [keys-sheet.png](keys-sheet.png), all sixteen prescribed player views, [points.json](points.json), and [points-read.json](points-read.json) are refreshed. The panoramas remain RGB sRGB at 2048 by 1024. The player views remain 1280 by 720 with a 100° horizontal field of view and a pitch of 10°.

Round three is preserved in [rounds/round-3/](rounds/round-3/). Its manifest covers 84 unchanged files, including all eight keys, both sheets, the views, point records, scripts, prompts and report. The measure in this archive is the stricter owner supplied version present when this round began. The old point record is the delivered round three record. [The separate new baseline reading](reports/round-4-baseline-measure.json) confirms that round three noon scores 11.2 under the stricter measure.

Every sun disc is now 2° across, with a soft limb and a surrounding angular glow. Every visible moon disc is 4° across. These diameters correspond to 11.38 and 22.76 pixels vertically in the panorama. At the high noon and night positions the projection makes them approximately 29 and 58 pixels wide. Their headings and elevations still come directly from base/points.json. Bodies below the horizon remain below it.

The build reads [../moon/moon.png](../moon/moon.png) every time it runs. It projects the complete painted face north up without mirroring, with no phase shadow. Texture filtering preserves transparency at the limb. The light tint uses the physical model’s moon colour of (1.0, 0.94, 0.84) in linear RGB. The texture is never copied into a fixed substitute in this folder. Its current hash is recorded with every moon placement, so a changed face can be incorporated by rebuilding.

The compact sun and moon halos are clear of every complete 13 by 13 measurement square. Low moon halos were tightened in the second review because a broad glow left a visible hollow around the cleared rose sample. Night retains a soft, wider glow. The small residual contribution of the previous moon glow at the night zenith is removed, so that reading is now (20, 36, 68). The blue atmosphere outside the celestial edits is preserved exactly.

Sunset and dusk now have silver water paths centred under the eastern moon. They are clipped by the original water coverage, so the existing eastern ridge hides much of the direct path in these cameras. The visible water openings receive its light. Night has a wider silver sheen across the water toward the high moon. The paths use gentle horizontal glints and the same moon light colour. Golden hour’s solar glitter and water are unchanged.

Noon’s deepest blue has moved into the broad upper band away from the sun, around 20° to 40° above the horizon. Its high reading is (60, 130, 215) and its zenith is (78, 144, 222). The ceiling is lighter and softer as it approaches the high sun, the sunward air brightens, and the horizon stays pale. The new noon paint source was made with the built in image tool using our noon as the edit target and our golden hour as the palette reference. The untouched result is in [originals/13-noon-round-4.png](originals/13-noon-round-4.png), and the exact prompt is in [prompts.md](prompts.md). Its smooth colour variations contribute to the dome; generated land and generated celestial placement are discarded.

Morning’s high reading is (75, 145, 225) and its zenith is (90, 155, 230). Afternoon’s high reading is (85, 145, 210) and its zenith is (100, 155, 218). Morning is cooler and fresher, noon is deeper cobalt, and afternoon is warmer and softer. These replace the identical electric cyan readings. The current targets intentionally replace the old requirement to hold the high points to the brightness of (150, 190, 230).

Warm cream is confined to the sunward horizon. Morning’s opposite horizon reads (181, 216, 229) and afternoon’s reads (183, 213, 229), both pale aqua blue. The haze remains low. The day sky is assembled from broad elevation and angular fields with retained thin painted filaments, rather than local patches at the sample locations.

Dawn’s water away from the sun now reflects lilac and pale blue from higher on that side of the sky. Its reflection weakens toward the shore into a deeper blue body colour. The near water is visibly darker than the far water, and a little of the rose cloud reflection remains. Dawn’s sunward water and its registered terrain remain in place.

The verifier compares the final pixels with round three. Every solid terrain pixel and every complete connected grey face is unchanged. Morning, noon, afternoon and golden hour retain every solid water pixel. Dawn, golden hour, sunset, dusk and night preserve every pure sky pixel outside the explicitly bounded celestial edits. The stellar catalogue is unchanged. Original material coverage also preserves every coastline, ridge, tree and cube position through the mixed boundary pixels.

I ran the supplied measure without changing it. The final afterBestGrade scores are dawn 3.1; morning 5.1; noon 1.5; afternoon 3.5; golden 4.1; sunset 5.8; dusk 4.7; night 3.1. The largest is 5.8, so all eight meet the limit of 6. The measure reports no notes. Independent readings of all 56 colour patches agree with its rounding. The largest card brightness error is 0.412 levels. Every zenith row is uniform, the maximum sky seam is at most two RGB levels, and the cloud masks remain clear within 4° of all four sky points. [The verification record](reports/keys-verification.json) records these checks and the preservation counts.

I reviewed the full key and player contact sheets, the complete horizon crops at native width, the noon and golden pairing, and views aimed at the celestial bodies. [The review folder](reports/round-4-review/) retains these inspections. Extra views [of the high noon sun](views/noon-sun.jpg) and [of the high night moon](views/night-moon.jpg) make their size and face reviewable, since those bodies sit above the prescribed cameras pitched only 10° up.

This round used one image tool call and three completed assembly and review passes. The second pass adjusted the low moon halos, reflection width and night sheen, and retained the tiny rounding values in the old night glow’s distant tail. The third pass softened a darker shelf above noon’s high point so the upper dome lightens toward the zenith. The archive clock began at 2026-11-15 00:33:10 UTC and the report was written at 2026-11-15 00:46:29 UTC. The elapsed time was 13 minutes 19 seconds. [The session record](reports/round-4-session.json) records the clock and source hashes.

The supplied angular horizon and raster sea edge still differ by about seven rows. The celestial coordinates and original sea boundary are both retained. The eastern ridge limits the visibility of the low moon paths. The physical fit proves the four sampled sky colours, rather than a complete runtime sky table comparison. Reflections remain a restrained mood treatment rather than a wave simulation. The generated noon source is 1774 by 887 and supplies only a smooth field in the native 2048 by 1024 assembly.

Keep the round two and round three archives, the existing originals and the sibling moon file for rebuilding. The main round four work is in [scripts/round4.py](scripts/round4.py). The following commands rebuild the keys, independently read them, measure them, verify preservation, refresh review images and append this report.

```sh
python3 -I scripts/build_keys.py
python3 -I scripts/read_points.py
python3 -I measure.py
python3 -I scripts/verify_keys.py
python3 -I scripts/review_round4.py
python3 -I scripts/report_keys.py
```

The supplied physical model, stricter measure, base renders, physical underlays and earlier style package were not changed. All project writes for this round are inside this folder.


# Round 5

Round four is preserved in [rounds/round-4/](rounds/round-4/), including its eight keys, sheets, views, scripts, point records and report. The archive manifest verifies all 109 saved files. Only noon, afternoon and dusk have changed. Dawn, morning, golden hour, sunset and night retain their complete panorama files byte for byte.

Noon now reads (95, 96, 98) on the sunlit upright grey face, (63, 71, 82) in shade and (125, 126, 127) face up. Afternoon reads (120, 115, 108), (60, 68, 79) and (111, 113, 116) on those same faces. These are the exact supplied table colours across each complete connected face. The other grey cube tops receive the same face up light. A matching linear light correction removes the old warm cast from the land, using the existing illuminated and shaded material weights. Geometry and material coverage remain fixed.

The sky corrections use smooth broad fields over the archived pixels. Noon receives a small correction across the polar cap, fading out below 70 degrees and around the sun. Afternoon and dusk receive small corrections across their low sunward haze, fading out by 18 degrees. There are no isolated patches at the reading points. The opposite haze, the three other sky point readings in each changed key, and noon’s deep blue at 30 degrees are unchanged.

Noon’s zenith reading changes from (78, 144, 222) to (89, 144, 214). The largest change anywhere in its pure sky is 11 RGB levels and 1.52 in OKLab times 100.

Afternoon’s toward reading changes from (240, 225, 199) to (239, 226, 203). The largest change anywhere in its pure sky is 4 RGB levels and 0.52 in OKLab times 100.

Dusk’s toward reading changes from (227, 154, 110) to (229, 155, 111). The largest change anywhere in its pure sky is 2 RGB levels and 0.45 in OKLab times 100.

Every solid water pixel is unchanged, including dawn’s sea gradient and the silver moon paths. The sun and moon discs, their halos and the star pixels are unchanged. The sun remains 2 degrees across and the moon remains 4 degrees across. Every complete grey face outside noon and afternoon is unchanged. Dusk’s face toward the glow remains (53, 50, 65), brighter than its shaded face at (19, 26, 43).

I ran the unmodified measure on the final PNG files, then ran the supplied engine fitter on the resulting points-read.json from the supplied engine checkout. The three original misses were noon zenith 6.6, afternoon toward 6.3 and dusk toward 6.2. They now read 5.7, 5.9 and 5.8. All 32 sky points are at or below 6. The largest is 5.9. The following sentences give every fitted distance in the order zenith, high, toward, away, lit face, shaded face and face up.

Dawn reads zenith 3.6, high 1.9, toward 1.0, away 3.7, lit face 4.9, shaded face 3.4 and face up 2.3.

Morning reads zenith 5.8, high 5.4, toward 2.8, away 1.3, lit face 4.3, shaded face 5.8 and face up 1.7.

Noon reads zenith 5.7, high 0.8, toward 2.9, away 1.9, lit face 0.2, shaded face 0.7 and face up 0.2.

Afternoon reads zenith 2.9, high 2.6, toward 5.9, away 1.5, lit face 0.6, shaded face 0.8 and face up 0.5.

Golden reads zenith 1.7, high 2.1, toward 3.6, away 3.4, lit face 1.5, shaded face 4.5 and face up 5.8.

Sunset reads zenith 0.7, high 1.7, toward 1.6, away 3.4, lit face 9.6, shaded face 3.7 and face up 2.2.

Dusk reads zenith 1.5, high 5.8, toward 5.8, away 1.7, lit face 10.4, shaded face 1.3 and face up 1.8.

Night reads zenith 3.6, high 5.0, toward 0.6, away 0.5, lit face 2.6, shaded face 1.4 and face up 0.7.

These are the engine fitter’s distances with lighting and exposure included. Its full output and fitted grades are in [the fitter record](reports/round-5-fit.txt), with a machine readable distance record in [the fit JSON](reports/round-5-fit.json). The larger sunset and dusk card distances are recorded without changing those accepted cards. The fixed light Python measure still reads dawn at 7.8, while the engine fitter’s worst dawn sky point is 3.7. The engine result is the acceptance verdict for this round.

Independent reads of all 56 patches agree with measure.py to its rounding. The preservation checks verify the archive, the exact card colours, unchanged water, unchanged celestial pixels and stars, uniform zenith rows and sky seams no larger than two RGB levels. The largest pure sky edit across the three changed keys is 1.52 in OKLab times 100, below the fitter’s approximate visibility guide of 2. [The verification record](reports/keys-verification.json) retains the per key checks.

The key sheet, prescribed player views, player sheet and extra noon sun view are refreshed. I inspected the comparison of all three changed panoramas and the complete player view sheet. [The review folder](reports/round-5-review/) contains the before and after comparison and native horizon crops.

This round used no image generation calls and one image assembly pass after checking point candidates. The archive clock began at 2026-11-15 00:52:35 UTC and this report was written at 2026-11-15 00:59:17 UTC, an elapsed time of 6 minutes and 42 seconds. The build uses the accepted archive directly so later source painting changes cannot alter this small correction.

To rebuild this round, keep the round four archive and run `python3 -I scripts/build_keys.py`, `python3 -I scripts/read_points.py` and `python3 -I measure.py` in this folder. From the supplied engine checkout, run `bun tools/sky/fit.ts <this folder>/points-read.json --verbose` and save its output as `reports/round-5-fit.txt` in this folder. Then run `python3 -I scripts/verify_keys.py`, `python3 -I scripts/review_round5.py` and `python3 -I scripts/report_keys.py`. The new colour controls are in [scripts/round5.py](scripts/round5.py). The supplied physical model, measure, base images and sky table are unchanged.
