# Body paint — round 6: deeper, soft feather tips

Addressed the round 5 feedback in the full-resolution maps. The pale brushes are deeper at their shafts, taper to shallow side ends, and dissolve inward along the vane’s barb directions. The five rows, their positions, grey notches, flank taper, plain plumage and cards are preserved.

See the [native 2,048-map crop beside the concept](checks/bars_2048_beside_concept.png), the [same-texel before/after comparison](checks/bars_2048_before_after.png), and the [native crop alone](checks/bars_2048_native.png). These are computed from the delivered maps. The comparison leaves the atlas crop at one output pixel per texel and scales the concept to **2,174 pixels per metre**, using the crop’s median **0.460 mm per texel**. UV scale varies locally; the numerical measurements below use each feather’s placed frame in millimetres.

## Construction and measurements

The earlier source-space measurements overstated the depth surviving placement and binary region assignment. `paint.py` now measures down each feather from its own free edge after the accepted terminal warp. A broad central brush tapers toward the side barbs. The existing placement frame carries its shaft and point along the baked feather direction; no placement, angle, source selection or row spacing changed.

The strand coverage follows tangents measured from the generated vane’s fine drawing. Deterministic variation along that flow gives the strands different inward lengths. The coverage threshold compensates for interpolation narrowing the fade, and the outside inherits the source cut-out’s fringe. The region map remains pure red/yellow: softness comes from intermingled barb ends. Fine value drawing and the existing vane relief continue through the pale area. No new image generation or relief was added.

The checks now measure the **composed 2,048 region map**, with each visible texel attributed to its feather. Across 16 dorsal tips, the 98th-percentile shaft reach is **8.45–9.94 mm**, median **9.32 mm**. Side reach has a median of **3.02 mm**. Pooled shaft coverage declines from 90% to 10% over **5.58 mm**, from **4.64 to 10.22 mm** inward; isolated strands extend beyond the percentile reach. See [the per-feather measurements](checks/tip_depth_2048.json).

The change is concentrated at the shafts. The pale area totals **21,592 texels**, versus 23,843 before: deeper centres coexist with shallower side ends and open strand gaps. This is not a uniform widening of the old crescent.

## Preserved material

All placement records match the previous delivery. The four intervals between the five rows remain **44.0, 41.2, 44.4 and 40.3 mm**. The base outside the union of old and new pale tips is byte-identical. Opaque height, roughness and occlusion, and all five body-card maps, are byte-identical. The card strip still reads its live **98.5 × 33 mm** dimensions. All fifteen accepted study maps, including `body_plain`, remain byte for byte unchanged.

Cream keeps the accepted value distribution: linear minimum **0.4564**, median **0.4969**, 95th percentile **0.5333**, maximum **0.5457**. Its mean is **0.500007**; body mean is **0.500108**, and card mean **0.499998**. The unchanged opaque height spans **0.541–1.009 mm**, encoded in the same 4 mm range. All ten layer names remain the same.

## Validation and review

`check.py` passes ownership, neutral value, region palette/ring, spacing, physical tip depth and dissolve, unchanged-material checks, and the existing card/study checks. Maximum tested base/light correlation is **0.00472**, with owned quadrant means within **1.88%**. A clean rebuild reproduced all ten PNGs and `layers.json` byte for byte. Final painting took **13.26 seconds**; the clean rebuild took **14.93 seconds** on this machine.

The final maps were also run through `zsh tex/paint/look.sh` into [look_round6](checks/look_round6/), including the back close-up, rear quarter, side and size strips in default, loud and dark dyes. The software renderer’s 1,024 limit is kept separate from the native-atlas evidence above. Additional top/back views use the same game renderer through `review.py`.

The native map resolves the directional inner breakup; individual binary texels remain visible when magnified, and the software renderer merges the finest strands. The concept still has finer painted fibre detail and stronger overlap shading. Existing plain silhouette cards can make small nicks in a few bars. No model or other painter’s source files were changed; built packs remain outside the repository.

```sh
python3 -B tex/paint/body/paint.py
python3 -I tex/paint/compose.py --out tex/paint/body/checks/composed
python3 -B tex/paint/body/atlas_review.py
python3 -B tex/paint/body/check.py --rebuild
zsh tex/paint/look.sh "$PWD/tex/paint/body/checks/look_round6"
python3 -B tex/paint/body/review.py
python3 -B tex/paint/body/check.py --look look_round6
```
