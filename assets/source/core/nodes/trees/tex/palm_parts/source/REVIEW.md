Four original source plates were painted with the built-in image generation tool. No image-search service, downloaded reference photograph, existing game image, fallback image API, or CLI image generator was used. The repository's palm concepts and DESIGN.md were inspected as the art direction. The generation prompts are preserved verbatim in generation_prompts.json.

| Frozen original | Native size | Review and use |
| --- | --- | --- |
| generated_crownshaft.png | 953 × 1651 | Accepted for clean living pigment, long smooth sheath boundaries and sparse vertical striations. The generator returned a portrait plate despite the square request. Reconstructed at the atlas region's dimensions; recoloured to the design swatch; top lip and bottom tan/grey transition registered explicitly. |
| generated_sheath.png | 1254 × 1254 | Accepted for irregular crossing sheets and fibres, yellow-green stalk bases above, dry fibres below. Local contrast reduced in base colour, with relief and cavity response transferred to data maps. |
| generated_cut.png | 1254 × 1254 | Accepted for torn short fibre ends, irregular larger chips and hatchet facets, without growth rings. Its disc was larger and its bark rim narrower than requested. Both were registered in the build. The narrow original bark edge needed added fine radial fibre texture to avoid stretching artifacts. |
| generated_details.png | 1254 × 1254 | Accepted for distinct green/yellow/brown husks, a root surface becoming soil-caked downward, and a finely ridged ochre stalk surface with small knots. Cropped along measured native boundaries before each independent wrap was built. |

Every generated original remains unmodified at its returned size. There were four generation calls and no rejected or omitted source plates. All subsequent compositing, palette adjustment, seam construction, fine detail, height, normal and ORM work is reproducible in ../build_material.py.

sRGB.icc is a frozen standard sRGB profile used by the base-colour writer. Keeping this payload fixed prevents profile creation dates from changing PNG hashes on rebuild. It is not an image reference.

## Round 2

The four original plates above remain untouched. Two additional built-in image-generation edits were accepted and saved at their native **1254 × 1254** dimensions. Exact prompts are in `generation_prompts_round2.json`; the updated manifest includes their SHA-256 hashes.

| Frozen original | Review and use |
| --- | --- |
| generated_crownshaft_round2.png | Accepted for four long overlapping sheath boundaries, smooth vertical pigment streaks and three small tan abrasions. Its source green still needed the explicit top-to-bottom palette correction and quantified 10–15% horizontal value variation. Source edge traces are registered with RGB; `round2_material.py` gives their lips physical relief without depending on painted shading. The original registered foot collar is preserved. |
| generated_root_round2.png | Accepted for dusty desaturated root skin, delicate lengthwise fibres and hairs, a tiny redder abrasion and soil increasing toward the bottom. The builder centres the midsection on #78674A and makes the top greyer/paler and the bottom dark grey-brown. Soil and fibre height remain appropriate to a 6 mm root. |

Input references were the original generated plates and our own repository's palm-parts concept and royal lineup. No external image search, game imagery, fallback API or CLI generator was used. There were two generation calls, no rejected variants. `round1/` is an audit snapshot of the prior outputs, builder, checker, layout, metadata and masks; the working rebuild entry point remains `../build_material.py`.
