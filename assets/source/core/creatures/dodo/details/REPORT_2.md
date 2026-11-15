# Loose feathers — round 2

Repainted `contour`, `contour_plain`, and `down` with the built-in image-generation tool. **Flight, tail, and their region maps are byte-for-byte unchanged.**

- **Body feathers:** elongated, gently curved vanes, two parted-barb splits, visible pale-grey shafts through the vanes, and down on both sides of the base. Overall silhouettes are now 384 × 896 and 400 × 896 pixels, versus 520 × 896 and 660 × 896 before. The breast feather remains slightly broader and fluffier.
- **Contour tipping:** the region boundary follows the painted, interleaving cream barb tips around the crown. It no longer uses a solid geometric cap.
- **Quills:** restrained neutral grey instead of white. Exposed lengths decreased from approximately 99 to 89 pixels for contour, 70 to 39 for plain, and 65 to 50 for down, measured below the last substantial fluff.
- **Down:** open curling fibers with transparent spaces through the plume. Mean alpha over covered pixels is 68/255; fewer than 1% are fully opaque. It keeps the hood dye.

Checked the final default-dyed sprites at **128 and 32 pixels on grass and sand**, upright, rotated, and mirrored. The body feathers retain an elongated vane and shaft; down remains an airy wisp. `preview_game.png` uses the 128px import before reducing to 32px. `preview_round2_comparison.png` shows the old and new silhouettes side by side. These are unlit texture composites, not a new engine capture.

`preview.png` retains the full-size, 128px, and 32px layout on mid grey and sand. All ten exports remain 1024² RGBA, neutral-grey base colors, exact region IDs, matching base/region alpha, and at least 64px transparent margins. Export checks pass; measurements are in `validation.json`.

Painted masters and exact prompts are retained in `sources/round2/` and `generation_prompts_round2.json`. Rebuild with `python3 build_feathers.py` (now routes to `build_round2.py`); verify with `python3 check_exports.py`. Round-one sources and `REPORT.md` remain as history.
