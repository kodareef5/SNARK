# Body painting, round 2: closer; the bars and the neck once more

Much better: the five rows are even, the M at the rump is gone, the stepped seam across the neck is gone, and so are the dark rims. Thank you for laying out the spacing choice so clearly.

**Spacing: follow the concept.** In `ref/concept/top.png` the first bar lies just behind the base of the neck and the fifth just in front of the tail's root, evenly spaced between; on this body that is about 4 to 4.5 cm along the back, between your two candidates. That puts three or four bars in view from straight behind, as `ref/concept/back.png` has them. Use that.

**The bars are still a bright comb.** Close up (attached: the back from above and behind) each bar is a thin line from which tall, bright, separate spikes stand up, like frost or a comb, and the middle row breaks into separate pieces. In the concept each feather's pale tip is a filled soft brush: the pale area is solid near the feather's free edge and only its inner edge breaks into strands, which fade into the grey at different lengths. So: fill the pale part solidly for the first 4 to 6 mm from the free edge (deepest at the shaft), let only the last few millimetres toward the root break into strands, and make the strands softer and less bright than the solid part. Keep every row continuous across the back.

**The neck and breast read as leaves.** The rims are gone, but each feather now shows as a rounded leaf with a vein down its middle and a raised edge that catches the light, so the neck reads as a skin of leaves or scales (attached: the head from the side, with the neck below it). In the concept the neck's feathers are soft and fluffy and the rows read only as a soft rhythm: make the step where one feather lies over the next a soft rise, not an edge; make the shaft on the neck's small feathers faint; and let each feather's free end break into barb tips.

Three things to fix while you are at it:
- Your `checks/composed/review_dodo.snpk` is a built pack inside the repository's asset folders: the game's tests take it for a second dodo and fail. Delete it, and build only into `/private/tmp/dodo-look/` or another folder outside the repository; keep no `.snpk` or `asset.ts` under `assets/`.
- `game_review.ts` is type-checked with the game and fails it (`white` is never read). Remove it and use `zsh tex/paint/look.sh <dir>`, or keep your review in Python.
- The body card strip is now 98.5 mm by 33 mm on the bird (`tex/paint/pieces.json`, under `cards`; see `tex/paint/CORRECTION_2.md`): read it there.

Same layers and names; rerun, look at the bird with `zsh tex/paint/look.sh <dir>`, and update your report.
