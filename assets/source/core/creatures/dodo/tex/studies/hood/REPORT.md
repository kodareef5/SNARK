# Hood study — round 3

The round-3 art revision rebuilt only `cap` and `cap_to_mane`. The accepted `mane` and `hood_cards` remain byte-for-byte unchanged, including their ten maps, two placement files, 140 individual source files, source manifest entries and set metadata. The earlier acceptance records are archived in `superseded/`. `accepted_hashes.json` now freezes all twenty accepted delivery maps, their four layouts and the four selected originals; the checker verifies them. Cap and transition placement files also match round 2 exactly.

## Rounded cap

The round-2 cap blended compact vanes into open card feathers at their ends. That produced the pointed, fern-like fronds identified in review. The new cap uses twelve generated plush contour tufts with rounded, softly uneven ends, short fine barbs and a largely buried shaft. There is no open-card tail blend. The lighter drawing covers the soft terminal tufts instead of tracing a thin outline.

The final source is [cap_plush_r3_original.png](source/cap_plush_r3_original.png), generated with the built-in image tool from our concept reference. Its [exact prompt](source/cap_plush_r3_prompt.txt) is retained. An earlier rounded-vane trial was too smooth and outlined; its original, prompt and individual layers are archived in ignored `superseded/`. The selected original remains untouched at native resolution. No external reference images or API fallback were used.

Density, lengths, widths, positions, rotation variation and overlap order are unchanged. The cap still places 8–12 mm and 15–20 mm feathers irregularly, pointing down. Its linear value standard deviation is 0.184, close to round 2's 0.188: the darker roots, lighter tips and fine strand drawing remain visible unlit. The source silhouette uses its soft partial-alpha short fibres rather than the stronger alpha calibration intended for edge cards.

The height construction, 3.2 mm full range and final softening are unchanged. Fine barbs lie over rounded tuft relief, with the same 1.6-study-pixel softening (about 0.22 mm). The shaft remains available as a separate layer. `cap_to_mane` uses these rounded specimens at the top, progressively lengthening into the exact accepted mane source layers through the existing placement gradient. There is no horizontal material boundary.

## Delivered maps

All twenty maps retain their names and 2048 × 2048 dimensions.

| Set | Span | Tiling | Full height range | Status |
|---|---:|---|---:|---|
| `cap` | 0.284 m | X and Y | 3.2 mm | Rounded plush feather source |
| `mane` | 0.284 m | X and Y | 4.2 mm | Accepted round 2, unchanged |
| `cap_to_mane` | 0.284 m | X only | 3.8 mm | Rounded cap into accepted mane |
| `hood_cards` | 0.341 m | None | 4.2 mm | Accepted round 2, unchanged |

For each set:

- `*_base.png` is neutral sRGB drawing from the generated feather values: darker root fibres, lighter terminal barbs and fine strands. Broad directional exposure is removed, then mean linear grey is normalized to 0.50. No rendered lighting or AO is multiplied into the base. Cards remain RGBA with dilated RGB.
- `*_height.png` is computed 16-bit linear authored relief: soft camber, tuft lift, strand bundles, fine barbs and a subtle shaft. The stated range is full black-to-white displacement, not each feather's height.
- `*_normal.png` is computed from the delivered quantized height at its declared scale, with OpenGL picture-up green and the correct wrapping axes.
- `*_packed.png` contains restrained symmetric height occlusion in red, dry matte roughness in green and zero metalness in blue.
- `*_regions.png` is pure magenta, region 4, including transparent card padding. The isolated study has no adjacent colour region. The final bird still needs the natural dark undyed contact crease where the hood meets face or brow.

The forty active specimens in `source/feathers.json` each retain aligned cutout, alpha, height, shaft and full-precision NPZ layers. New cap files use `cap_round_r3_`; accepted source paths are unchanged. Card boxes, roots, tips and constituent placements in `study.json` are unchanged. Earlier sources and round reports remain archived.

## Checks and visual review

`python3 -B check.py` completed with **zero failures**. The 152 protected file hashes match, accepted metadata and source entries match, and cap/transition placement hashes match.

| Set | Region 4 mean, linear | Value standard deviation | Quarter spread | Height/normal correlation, worse axis | Worst valid wrap ratio |
|---|---:|---:|---:|---:|---:|
| `cap` | 0.499997 | 0.184 | 0.334% | 0.999925 | 1.054 |
| `mane` | 0.500002 | 0.128 | 1.572% | 0.999872 | 1.012 |
| `cap_to_mane` | 0.500000 | 0.164 | 0.687% | 0.999922 | 1.011 |
| `hood_cards` | 0.500003 | 0.122 | 0.004% | 0.999970 | n/a |

Every dyed base pixel has equal RGB channels; all heights are 16-bit; metalness is zero. Cap base/light correlation is 0.00192 and transition correlation is 0.00377 across twelve light azimuths. Their independent normal reconstruction agrees within one byte. The cap's worst seam ratio is 1.054; transition X is 1.011. Transition Y is intentionally not tiled. Translated primary boundary neighbourhoods agree exactly. Roughness remains 226–233/255.

Final field corrections retain 89.4% of the cap's source value variance and 91.7% of the transition's. The two inspected new cap specimens retain original/base value correlations of 0.951 and 0.924 over the entire jointly supported feather, including its rounded tip. The former exclusion of the changed lower half is removed.

The accepted cards still pass the 512- and 128-pixel alpha-cut checks, with all eighteen elements surviving, non-overlapping boxes, valid root/tip landmarks and zero transparent RGB dilation error.

The requested finish is [cap_concept_round3.jpg](checks/cap_concept_round3.jpg): the untouched concept crown beside the delivered cap dyed umber **#413225** and near-white **#F3F1EA**, relit at the same **4500 px/m** as the native head reference. The lower row uses **1500 px/m**, the whole-bird concept density, without enlargement. The material's flow is rotated to follow the crown. The reference is neither recoloured nor used as texture pixels.

I inspected that sheet, the original/base/relit specimen comparison, whole fields, transition, dye sheet, repeats and reduced-size views. Rounded fuzzy lobes replace the long fern-like points; the cap remains densely textured in umber and reads as light plumage in near-white. The fine shaft no longer dominates each cap feather. The transition gradually develops longer hanging vanes. Pink and lime retain the same rounded tuft structure. At a 200-pixel bird footprint the cap retains fine mottling; at 50 pixels it settles toward the even dark hood tone.

Other regenerated review files include `concept_scale_comparison.jpg`, `original_base_relit.jpg`, `drawing_unlit_and_relit.jpg`, `dye_contact.jpg`, `detail_100percent.jpg`, `offsets_contact.jpg`, `read_sizes.png`, and the accepted cards at quarter size over rose. All are made from the delivered maps. `checks/` is ignored and reproducible.

## Rebuild and reuse

From this directory, run:

```sh
python3 -B build.py
python3 -B check.py
```

`python3 -B build.py` reconstructs all four sets and every individual feather layer directly from the four selected original atlases, without any previous maps, manifests or cached fields. `--sets cap cap_to_mane` remains available for a selective rebuild. `--scale` and `--direction` change placement dimensions and orientation numerically; alternate settings intentionally cease to match the frozen delivery/layout checks. Restore defaults for the specified study. For individual painting, `stamp` accepts `length_mm`, `width_mm`, `angle_deg`, `mirror`, `tone` and `lift`; the NPZ field order is alpha, height, pigment (linear offset from 0.5), roughness and shaft. Transform all fields together and derive normals from the final quantized height. Coordinates start at the upper-left, and boxes use exclusive right/bottom bounds.

## Limits and time

The flat swatch remains more contrasty and less form-lit than the painted crown. It establishes feather shape and material, not the final skull curvature, mesh tangents or card attachment. The specified umber is warmer than the concept's intended brown; the comparison preserves both as given. Near-white can clip the brightest tufts under the preview's key light, while near-black suppresses the smallest barbs. Finite source diversity can become apparent over a large repeated field. Relief remains authored rather than physically measured.

Round-3 work began at approximately 2026-11-14 22:30 UTC and finished at about 22:42 UTC, roughly 12 minutes. Two cap atlas variants were generated; the second is selected. The final selective build took 34.75 seconds and the complete check took 44.66 seconds. Work stayed within `tex/studies/hood/`; Blender was not used.

## Files

The accepted build reads exactly four generated originals, retained in `source/` with their matching `*_prompt.txt` files:

- `cap_plush_r3_original.png`: rounded plush cap feathers.
- `mane_full_r2_original.png`: the mane and the long end of the transition.
- `cap_r2_original.png`: edge-tuft card feathers.
- `mane_r2_original.png`: single mane card feathers.

Superseded originals, prompts, trials, old scripts, reports, manifests and cached layers are in ignored `superseded/`; `checks/` was left unchanged. `build.py` regenerates the forty specimens' aligned layers, `source/feathers.json`, the four placement files, `study.json` and all twenty delivered PNGs. `check.py` uses `review.py` and the small `accepted_hashes.json` verification config.

A clean rebuild ran with every delivered picture, layout, `study.json` and derived source layer removed. Archive and check-folder access was blocked during the build; its only local reads were `build.py` and the four originals above. **All 20 delivered pictures matched their pre-tidy SHA-256 hashes byte for byte**, as did all four layouts. The clean rebuild took 31.25 seconds. Nothing required to rebuild is left in `superseded/`.
