# Second round: painted appearance targets and revised flint hatchet

The first-round files in the parent folder are preserved. Its `REPORT.md` has an appended second-round section. This folder is the revised technical set; use its hatchet geometry and projections when modelling the new blade.

The five new finished images are in the parent folder: `paint_pick.png`, `paint_hatchet.png`, `paint_spear_head.png`, `paint_first_person.png`, and `paint_sheet.png`.

- `source/tool_masters.blend`: all three construction masters, with the revised rounded, asymmetric flint hatchet.
- `hatchet_side.png`, `hatchet_edge.png`, `hatchet_end.png` and their `_mask.png` files: revised, dimensioned orthographic projections.
- `lineup.png`, `read_sizes.png`: revised technical comparison sheets. The other original views are rebuilt here too, making this set self-contained.
- `guides/`: direct renders used as the drawing under the image-tool paint.
- `paint_sources/`: all raw generated paintings, exact prompts, and native 64-pixel transparent inventory pictures.
- `checks/measurements.json`: all 66 dimension and 52 cross-view checks.
- `checks/revision_audit.json`: additional blade measurements, original-file hash check, painting/guide contour comparison, and final-file hashes.
- `checks/*_orthographic_guides.png`, `*_paint_comparison.png`, and `paint_inventory_check.png`: visual evidence.

Run `bash round2/rebuild.sh` from the parent folder, or `bash rebuild.sh` here. Blender 5.3, Python 3, Pillow and NumPy are required. The scripts reconstruct the geometry, render the views and drawing guides, rerun measurements, and assemble the exact retained image-tool outputs. Rebuilding needs no network or API key. Regenerating the creative paintings is optional and nondeterministic; `paint_sources/PROMPTS.json` records the built-in image-tool prompts and input paths.

The orthographic master defines measurements and construction. The paintings define the finished material treatment and first-person appearance. The paint-comparison sheets explicitly show the small generative contour differences; those have not been hidden by stretching or registration.
