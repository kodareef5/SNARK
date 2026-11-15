This directory contains the complete offline inputs and regenerated assembly data for the second fig/banyan foliage set, **round 3: sun leaves, shade leaves, and interior foliage**.

`fig_specimens_set2_generated.png` is the untouched **1254 × 1254 RGBA** output from the built-in image generator used for this set. It supplies sixteen smooth oval fig silhouettes, fine tissue pigment, and veins. The exact prompt is `set2_leaves_prompt.txt`. This revision reuses those specimens through the editable builder; no new image generation or reference download was needed.

`generated_aerial_roots.png` is the untouched **1254 × 1254 RGBA** source retained from the first set; `roots_prompt.txt` is its exact prompt. Its bark/fibre tissue supplies the existing twelve-strand and five-strand curtains. Both curtains remain pixel-identical in all four maps, including transparent padding.

The builder removes broad illumination from the source tissue and composes individual blades at 2× delivery sampling. The accepted round-2 assembly remains intact: six terminal rosettes in cells 0–2, five along cell 3’s diagonal, and whole lower blades supporting them. No leaf, shape, position, overlap, margin, height, or normal changes in round 3.

`habitat_palette()` changes only foliage RGB and mass occlusion after that deterministic assembly. Cells 0/2 receive warm sun-leaf pigment; brighter pigment follows each blade’s own base-to-tip axis. Cell 2 retains its original fresh and yellowed blades. Cells 1/3 receive cooler shade-leaf pigment and retain turned undersides. The mass’s existing depth pools guide deeper pigment per complete visible leaf and a broader occlusion response. There is no light direction in this pass. Twig pigment, card AO, roughness, all geometry, and root channels remain exact.

The mass calibration separately targets its overall mean (56/70/44), exposed upper tissue (72/88/58), and deep cool pigment near (28/38/30). Filters and colour operations retain the original periodic domain. The full height encoding is still **0–200 mm**; normals remain derived from the saved quantized height at the region’s physical scale.

`round2_preservation_reference.json` was captured before this revision. It records decoded-pixel hashes for all alpha, height, normals, roughness, metalness, card AO, root maps, twig colour, leaf IDs, and material IDs; entire height/normal PNG hashes; a canonical construction-record hash; layout hash; and previous mass-pool fractions. The checker verifies these independently. Hashes use contiguous pixel bytes and explicitly little-endian uint16 for height and leaf IDs. This small record is a verification input, not an obsolete atlas.

`round1_preservation_reference.json` remains in use to verify the original root regions and mass height/normal, and to retain the original cluster-area comparison. Its old mass base and ORM hashes are historical; round 3 intentionally changes mass RGB and occlusion.

`concept_fig_crop.png` is an unmodified pixel crop of the repository’s fig lineup. `concept_registration.json` records the source hash, crop rectangle, and approximate physical scale. The painting has no calibrated camera. No external or existing-game picture was searched for or downloaded.

`composed_master_2048.png`, `rectified_tissue.png`, `leaf_ids.png`, `material_ids.png`, and `composition.json` are regenerated outputs, not independent build inputs. Composition records retain each accepted precursor leaf’s source, dimensions, tilt, pigment, group, location, height, supporting leaves, gutter translations, root paths, seeds, periodic field, and height integration settings. Each foliage region’s **`habitat_palette`** records the final transform applied to those precursor pigments. Material IDs: 0 transparent, 1 twig, 2 mature leaf, 3 aerial root, 5 fresh leaf, 6 yellowed leaf, 7 underside.

`cleanup_manifest.json` records prior cleanup and this revision’s in-place replacements. Reused full-size sources and prompts, briefs, guide, feedback, current fit data, and runner records are retained. Rebuild from the parent folder:

```sh
python3 -B build_material.py
python3 -B check_material.py
python3 -B verify_rebuild.py
```

The last command rebuilds every deliverable, compares all four PNGs byte for byte, and reruns the independent checker.
