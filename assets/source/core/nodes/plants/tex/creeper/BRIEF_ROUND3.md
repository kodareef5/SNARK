# The creeper atlas, round 3

The creeper is being rebuilt. Until now its mass was a smooth mound wearing the `mat` band, which read as a green boulder with a leaf picture on it. From now the vine is overlapping leaf cards (your runs, hangs and ground pieces) standing off whatever it climbs, with the rubble showing in gaps and at the foot; behind the leaves, a few low clumps carry the `mat` as the vine's inner mass. Seen only between and behind leaves, that mass must read as depth: leaves in deep shade, not a second lit surface.

## The mat as the shade inside the vine

- Repaint the `mat` band in place (same rectangle, still repeating across) as the same tangle of heart-shaped leaves and stems, but deep in shade: an overall value about half of now, a mean near sRGB (30, 42, 14) against today's (66, 87, 21), with the gaps between leaves nearly black-green (around 10, 16, 6) and only the nearest leaf edges lifted a little. No sunlit leaves in it.
- Packed layer under the band: occlusion 0.35 to 0.6 (darkest in the gaps), roughness about 0.8. Height and normal shallower than now, so the shade does not pick up highlights.
- Every other element and pixel unchanged.

## Only what the final atlas needs

Rewrite `check_atlas.py` to check the final atlas on its own (sizes, rectangles, alpha, that the layers agree and that the build rebuilds them exactly), with no reference to earlier rounds. Then delete from `source/` whatever neither the build nor the new check reads (round 1's invariants and sprites, session notes the build does not use, and `run7_original.png` if only `run7_v2_original.png` is built from). Keep every generated original the atlas is built from, the prompts, and the README, updated.

Rebuild every layer, run the new check, and add to `REPORT.md` what changed, with a picture of the new band beside the old.
