# Hood painting — round 7

Repainted the cap, nape, edge, forehead and mane as overlapping feather vanes with rounded pale tips, darker roots and narrow shafts. A new generated specimen atlas replaces the tuft and strand sources in the painter. All ten delivered pictures retain their names and 2,048-pixel dimensions. The rebuild matches byte for byte.

## Drawing and placement

The cap uses eight small, joined contour-feather vanes. Its nominal scale remains **10 mm on the crown, increasing to 18 mm at the back of the head**, with smaller feathers at the face contact. Individual sizes vary by a third. Positions vary along and across the baked flow; the visible population follows loose, staggered rows with small angular departures. The pale free ends are broad value transitions, not bright outlines. Fine interlocked barb drawing remains in the base; occasional shafts have a restrained pale accent. Relief stays low: crown normal-slope RMS is **0.0284**.

The nape grows into eight broader feather specimens with the same drawing. On the mane card, **56 feathers in five overlapping painted rows** measure **32.7–49.7 mm long and 17.6–25.0 mm wide**. Their terminal row ends at varying depths, with complete rounded tips instead of fine strand tails or tips clipped against the rectangle. At the final 512 atlas resolution, the longest surviving tip reaches **79.2 mm** down the 80.7 mm rectangle.

The edge uses the cap's specimens, pigment treatment and low relief. Its upper half is solid across the strip. Below it, **14 clusters of two to five feathers, 4.06–7.94 mm long**, end in connected rounded tufts. At 512, the upper half remains 100% solid and there are **zero detached tuft pixels**. Coverage is 94.5% at 9 mm depth and 69.5% at 10 mm: the openings occur among the free ends. The forehead remains a dense, symmetric blunt tuft.

Every run reads the current rectangles and both physical texel dimensions from `pieces.json`:

| Card | Width × depth on the bird |
|---|---:|
| Hood edge | 71.4 × 13.4 mm |
| Forehead | 24.1 × 12.2 mm |
| Mane | 133.4 × 80.7 mm |

The wedge's region map is byte-identical to the previous delivery and matches the current bake. The **21,576 body-region texels** beside it retain their accepted neck-feather placement, height, roughness and occlusion. Their base differs by at most one 8-bit level from balancing at the contact. The card rectangles, baked direction field and mesh positions are unchanged by this painter.

## Renderer review

Ran `zsh tex/paint/look.sh` and inspected the head side, nape, hood edge and back-right views, including small-size renders at 200, 100, 50 and 20 pixels. Then `review.py` rendered those four views in **exact #3B302A, #6A4532 and #F3F1EA**, using temporary in-memory dye entries and the game's renderer. It freezes the built model and composed maps outside the repository; it does not change the production dye set.

- [Three-dye game comparison](checks/round7_game_dyes.jpg)
- [Head, concept umber](checks/look_round7_dyes/head_side_concept_umber.png)
- [Nape, warm umber](checks/look_round7_dyes/nape_warm_umber.png)
- [Edge, near-white](checks/look_round7_dyes/hood_edge_near_white.png)
- [Whole bird from behind](checks/look_round7_dyes/bird_back_right_concept_umber.png)
- [Original specimen beside placed base and relief](checks/source_preservation.jpg)
- [Cards at their physical proportions, from the final 512 atlas](checks/cards_physical_review.jpg)

The cap now resolves into small overlapping feather ends; the mane into broad vanes and rounded tips. Near-white retains the same feather structure. At distance the umber hood remains a dark cap. On the latest built model the face edge joins the cap, replacing the skin sliver visible in the earlier review pack.

**Remaining limits:** the extreme nape close-up still reveals tiering where the four physical cards overlap and repeat their shared artwork. The result has cleaner, more scalloped feather outlines than the painted concept. The mesh and shared UV layout were kept as requested. The reviewed pack is SHA-256 `075726a7f25da49dbd4621b643fcb0b83e53727e5383b376f98fdc49cc88046a`; [render provenance](checks/look_round7_dyes/inputs.json) records the actual texture and layer hashes.

## Validation

`check.py` passes: complete shell ownership, current card measurements, exact baked regions, neutral colour, connected edge at final resolution, accepted study unchanged, unclipped positions and normals matching the delivered physical height. The normal comparison includes the compositor's current extension of height and piece IDs into padding; its maximum byte error is **0**.

| Measurement | Final result |
|---|---:|
| Hood mean, linear grey | 0.499954 |
| Body portion mean, linear grey | 0.500037 |
| Cards mean, linear grey | 0.499990 |
| Maximum base/light correlation | 0.0090 |
| Delivered height range encoding | 4.2 mm |
| Clean rebuild | 10 PNGs + 3 JSON files identical |

The final paint run took **33.2 seconds**; the independent empty-output rebuild took **33.0 seconds**. Full [metrics](checks/metrics.json) and [rebuild hashes](checks/round7_rebuild.json) are in `checks/`.

## Files

The hood build reads the untouched **1254 × 1254 RGBA** generated original [plumage_r7_original.png](source/plumage_r7_original.png), with its exact [prompt](source/plumage_r7_prompt.txt). `plumage.py` extracts sixteen specimens and regenerates each one's cut-out, height, shaft and aligned material fields; [plumage_r7_elements.json](source/plumage_r7_elements.json) gives their original boxes, roots and tips. The former hood-study originals remain unchanged and are no longer paint inputs.

`paint.py` also reads `source/mane_random_state.json`, the current bakes and piece measurements, and the accepted body's aligned feather fields through `body_neck_recipe.py` and `wedge.py`. No archived picture, trial output or file under `checks/` or `superseded/` is a production input. An independent build into an absent output directory reproduced **every delivered picture byte for byte**, together with the placement and hash metadata.

Reproduce from the dodo folder:

```sh
python3 -B tex/paint/hood/paint.py
python3 -B tex/paint/hood/check.py
zsh tex/paint/look.sh "$PWD/tex/paint/hood/checks/look_round7"
python3 -B tex/paint/hood/review.py
```
