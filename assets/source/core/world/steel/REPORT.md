# Salt-worn painted steel

The 2 m tile carries 99.09% paint, 0.49% mill scale, 0.25% bare steel and 0.16% rust by fractional coverage. The exported base averages sRGB **(113, 111, 106)**. Fully exposed steel averages **(165, 165, 163)**. In the blue-green tint proof, the broken edge still exposes a narrow neutral reflection, and the old pit alongside it retains its brown rim. [Layer sheet](checks/layers.png)

## Round two

I rebuilt the film from overlapping native-resolution crops of three flat-lit, frontal enamel sources. A fourth, closer study supplied compound fractures and scuffs. All four were generated with the built-in image tool. The chip contours now range from hairline abrasions to flakes with both dark scale and exposed metal. Across the tile, the median resolved loss spans 2.9 mm. Forty-one reach 20 mm, and the largest spans 28.3 mm, measured at half tint coverage. All seven maps and six sheets were written from one complete build after the restart. [Generated sources](sources/) · [Source prompts](sources/prompts.txt)

## Files

| File | Construction and evidence |
| --- | --- |
| [base.png](base.png) | Native 2048² sRGB composite. The blue-green source pigment made the boundary of the paint easy to isolate. I neutralized the surviving film, preserved its chalk grain and placed sampled fractures at their physical scale. Grey scale and steel retain tonal variation within each break. A small amount of oxide pigment feathers into the paint around some older chips. |
| [height.png](height.png) | Each fracture contour defines a step down through the film. A slight raised lip, individual pit bowls and shallow orange peel supply the geometry. Rust bleeding affects colour and tint only. The full 16-bit interval spans 2.0 mm. Median intact paint sits 0.45 mm above median bare steel. |
| [normal.png](normal.png) | Wrapped central differences of the quantized height, using 0.9765625 mm per pixel and tangent +Y toward the top. An independent reconstruction from the saved height matched every encoded channel. The largest angular error from 8-bit encoding was 0.362°. |
| [roughness.png](roughness.png) | Soft changes in chalking and local finish modulate the matte film. Measured mean roughness is 0.627 on intact paint, 0.377 on fully bare steel and 0.892 in the brown oxide interiors. |
| [occlusion.png](occlusion.png) | Sixteen directional horizon searches over the relief, out to twelve pixels. The darkest values sit in deep, narrow pits. The median is 255, and 99.55% of texels are at least 250. I cross-checked sampled open and occluded texels against the saved height. |
| [tint.png](tint.png) | Surviving paint coverage, including paint bridges inside scuffs. Oxide deposited onto the paint attenuates the tint at those edges. |
| [metal.png](metal.png) | Exposed steel after separating rust and mill scale. Pure metal reaches 255. Mixed edge texels carry fractional coverage, and tint plus metal stays at or below 255 everywhere. |
| [material.json](material.json) | Records the 2 m tile width, 2 mm height span, null laying module and rounded mean of the exported base. |

Running `python3 build_steel.py` rebuilds the set from the four local sources. The generator renders into a staging folder and verifies the PNGs before replacing the delivered files. [Generator](build_steel.py)

## Proof sheets

| Sheet | What I checked and saw |
| --- | --- |
| [Half-tile offsets](checks/offset.png) | Base, height and roughness shifted by 1024 pixels on each axis. At native resolution, the old corners sit within continuous grain and sheen. |
| [Three by three](checks/tiled3.png) | Two native-resolution 6 m squares show the base and height. The larger losses dissolve into the field as the view pulls back. I could see neither a join nor a recurring cluster at sheet scale. |
| [Twelve by twelve](checks/tiled12.png) and [forty by forty](checks/tiled40.png) | The 24 m and 80 m fields use wrap-filtered reductions. The first retains faint grain, and the second reads as a single paint colour. I saw no grid or diagonal band. All 64 quarter-metre squares in the master are within 0.27 sRGB code of the tile mean in every channel. |
| [Diffuse relight](checks/relit.png) | The 1:1 row compares the unlit base with opposite 15° suns and a 70° sun. The lower row enlarges the same area. The bright edge of the old pit changes sides under the low suns, while the brown bleed stays in place. |
| [Registered layers](checks/layers.png) | All seven maps share a 293 mm crop and a 78 mm inset. The rust rim is rough, the steel face is smoother, and only part of the larger flake catches the grazing reflection. I compared each top-row panel pixel for pixel with its source map. |

## Remaining limitation

The smallest pits occupy one or two texels, so their rims soften under magnification. The proofs establish the reflection response in stills. Shimmer on moving railings remains untested in the browser renderer.
