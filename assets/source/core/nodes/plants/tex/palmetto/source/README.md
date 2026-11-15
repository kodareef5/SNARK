# Frozen palmetto sources

All `*_original.png` files are the full-size, unresized outputs of the built-in
image generation tool. The eleven selected elements were generated separately.
`fan1_original.png` is the retained first attempt; `fan1_v2_original.png` is the
selected fresh fan with more space around its points. The originals are never
edited by the build.

Round 2 selects `stalk_surface_v2_original.png`, an opaque full-bleed unrolled
petiole skin generated with the built-in tool. `stalk_original.png` remains as
the superseded cutout source. The exact edit prompt is in both `prompts.json`
and `stalk_round2_prompt.json`; no other source selection changed.
`round2_baseline.json` freezes the original layout and per-layer pixel hashes
outside the stalk. `stalk_round1_*.png` are exact original delivered stalk crops
for comparison, not build inputs. `round2_session.json` records revision timing.

`prompts.json` preserves every exact generation prompt, transparency setting,
and original tool save path. Those external paths are provenance only: the build
reads exclusively the copies in this directory. No CLI image API was used.
`session.json` records the start time and project reference paths.

The project concepts were viewed for their plant design, colour, and character.
They were not cropped into the atlas. No outside or game images were searched
for, downloaded, or imitated.

`recipe.json` is the editable layout/material recipe. `build_info.json` is a
generated record of source hashes, crop bounds, placements, and physical units.
All albedo cleanup, silhouette preparation, layout, edge dilation, relief,
normal derivation, roughness, occlusion, and vertical seam treatment are in
`../build_atlas.py`. No generated image service is needed to rebuild.

From the atlas directory:

```sh
python3 build_atlas.py
python3 check_atlas.py --rebuild
```

Dependencies are pinned in `../requirements.txt`. The build uses no random
numbers. Generated photographic texture is an authored source, not a measured
physical scan; relief is reconstructed from the source's geometry and ribs.
The stalk's 64-pixel width now spans the circumference of a 15 mm tube. Its
surface relief contains fibres and shallow tooth marks only; the broad colour
profile does not become height. A repeat still covers exactly 1.0 metre.
