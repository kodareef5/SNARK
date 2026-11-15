Frozen inputs for the sea grape atlas.

`*_original.png` files are full-size, unchanged outputs from the built-in imagegen tool. The selected fruit images are `fruit1_v2_original.png`, `fruit2_v2_original.png`, and `fruit3_v2_original.png`; the three first versions are retained for provenance. All ten leaves, the twig and bark use their first originals.

`prompts.json` contains every exact generation prompt and original tool output path. External output paths are provenance only: the build reads these local PNGs and requires no network, model, credentials or external image files.

`recipe.json` defines packing, scale, leaf widths, cluster lengths, roughness and height range. `geometry.json` records original-image coordinates for fitted berry spheres and seven twig blade ellipses/overlap heights. Berry centres and radii were fitted to distance-transform maxima with nearby duplicate maxima merged; twig annotations were made from the inspected original.

Round 2 changes only the packed material output. `recipe.json`'s `packed_material` settings control vein selection, hollow width and leaf occlusion depth; element roughness values set the leaf and berry finishes. The build derives these channels from the frozen images and geometry, retaining original stalk/wood materials. No packed-material field feeds base colour, height or normal generation. Before/after measurements and preservation hashes are in `../checks/round2.json`.

`prepared/` is a rebuildable inspection cache of the clean, scaled RGBA elements. `build_metadata.json` records transformations, physical berry diameters, normal convention and delivered-file hashes. `session.json` records start time and the repository concept references. `requirements.txt` records the Python package versions used.

From the atlas folder, run:

```sh
python3 build_atlas.py
python3 check_atlas.py
```

The second command generates all visual checks, writes `checks/measurements.json`, and exits nonzero if a requirement fails. Normal agreement is verified with an independently implemented finite-difference calculation against the reopened height PNG.
