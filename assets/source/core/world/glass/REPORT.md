# Weathered window glass

One tile covers 2 × 2 m. At street distance the pane settles to a muted grey-green. Up close, the most legible signs of weathering are the partial salt rims left by dried drops and the fine tracks where a wipe has thinned the film. They show best at the edge of a reflection. [Relighting and sheen study](checks/relit.png)

## Material files

| File | Construction and verification |
| --- | --- |
| [base.png](base.png) | A grey-green substrate, pale evaporated salt and slightly warmer mineral dust were mixed in linear light and encoded as 8-bit sRGB. The measured channel means are 115.97, 128.07 and 128.00. Across sixteen half-metre squares, the widest difference between mean colours is 0.14 of one sRGB code value. |
| [height.png](height.png) | Film thickness, salt rims and individually shaped grains add relief to a level pane. Tapered hairline scratches cut into it. The 16-bit export spans codes 0 through 65535 over 1 mm. The middle 98% of samples occupy an interval only 0.018 mm thick. A deep scratch and an occasional raised grain account for the extremes. |
| [normal.png](normal.png) | Wrapped central differences of the quantised height use a texel pitch of 0.9765625 mm. The tangent vector is proportional to `(-dh/dx, +dh/dy, 1)` with image rows increasing downward. Independent reconstruction from the saved PNG matched all three 8-bit channels at every texel. |
| [roughness.png](roughness.png) | Partial film coverage blends the clean pane into the duller salt layer. Wipes remove coverage along curved fibre tracks. The median linear roughness is 0.084 on clean patches, 0.334 in developed film, 0.450 on pronounced water rims and 0.700 on dust. All four were sampled using their respective deposit masks. |
| [occlusion.png](occlusion.png) | Eight horizon directions sample neighbouring relief out to seven texels along each axis. Faint occlusion sits inside cuts and at grain contacts. The mean is 254.80, and 86.1% of the map is fully open at 255. |
| [tint.png](tint.png) | A binary mask from dust coverage keeps the grains' own colour. Dust occupies 0.88% of texels at 0. Glass and salt film take the building tint at 255. |
| [material.json](material.json) | Records the 2 m width, 1 mm relief interval, null module and rounded measured sRGB mean. The finish is dielectric throughout. |

All six maps are 2048 × 2048. The [generator](make_glass.py) builds the original elements directly on the final pixel grid. Continuous fields wrap in both axes, and droplets, grains, swabs and scratches crossing a boundary continue on the opposite side. Running `python3 make_glass.py` rebuilds the maps and sheets from the fixed seed.

## Inspection

| Sheet | What I checked and saw |
| --- | --- |
| [Half-tile offset](checks/offset.png) | Base, height and roughness run left to right, each shifted 1024 texels on both axes. I inspected the old corners where they meet at each panel centre. Film, marks and grain density continue through the joins. Mean base-colour steps across both wraps are within 4% of the corresponding interior steps. |
| [Nine repeats at native size](checks/tiled3.png) | The left 6144 × 6144 field is base colour. The right field is height displayed over its full range. The initial dust looked coarse and pale, so I reduced grain size and softened its colour edges. I also lowered the broad film's colour contrast. The final sheet has fine local marks without a conspicuous landmark across copies. |
| [Twelve repeats per axis](checks/tiled12.png) | Filtered in linear light to 2048 × 2048. The colour settles evenly across the sheet. I could see neither a tile grid nor a diagonal band. The largest channel standard deviation after filtering is 1.26 sRGB code values. |
| [Relighting](checks/relit.png) | The upper samples multiply linear base colour by a constant fill plus diffuse sunlight. At 15° the bright side of the magnified grain moves when the sun reverses. At 70° the two sides approach the same value. The lower samples move a neutral studio light strip through the reflection. The salt rims soften its edge and the wiped tracks stay glossier. |
| [Aligned layers](checks/layers.png) | The same crop appears in each map, followed by its centre at 4×. The fine cut near the middle registers in height, normal and occlusion. Nearby dust coincides with rough spots and holes in the tint mask. |

## Remaining limitation

A few of the larger dried-drop rims look too smoothly lobed in the isolated roughness view. They are faint in base colour and disappear in the distance sheet. The sheen study uses a controlled light strip. The exact visibility of those rims under the game's post-shower sky is still unverified.
