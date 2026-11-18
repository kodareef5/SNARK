# Weathered Miami asphalt

One 2048 × 2048 tile covers 2.5 × 2.5 m. Each texel spans 1.221 mm. The base averages sRGB **(92, 92, 90)** across the tile. [Full-size base colour](base.png) · [Photographic comparison](checks/comparison.png)

## Round two

I replaced the first pass’s scattered pale flecks with twelve photographic sources generated under flat overcast light. The quilt keeps the irregular skins of charcoal binder on grey, buff and dark mineral faces. Exposed stone now covers **53.4%** of the tile. Dark binder and lodged sand fill the gaps. Pure binder now averages sRGB **(61, 61, 60)**, down from (79, 79, 78). The median surface tilt in both passes rounds to 24.3°. [Source crops](checks/sources.png) · [Relighting](checks/relit.png)

## Material maps

| File | Construction and verification |
| --- | --- |
| [base.png](base.png) | I quilted 64 crops from twelve 1254 px square sources on a wrapping 4096 px canvas. Paths of minimum colour difference preserved the stone detail at the joins. I balanced exposure, reduced residual directional edge lighting, matched contrast at the grain scale and averaged four samples per output texel. The 8-bit RGB PNG carries an sRGB tag. |
| [height.png](height.png) | I traced mineral footprints using colour, contour continuity and the narrow gaps between touching faces. Compact dark faces have a separate outline test. Each footprint received its own embedment, worn cap plane, tilt and edge bevel. A separate binder bed supplies recessed pores, fine grit and interrupted open or sealed hairlines. 94% of the modeled face area falls in the 4–12 mm equivalent-diameter band. Exposed faces stand a median 2.19 mm above nearby binder. The middle half spans 1.77–2.63 mm. The 16-bit export spans 0–65535. |
| [normal.png](normal.png) | Wrapped central differences of the saved height use the 8 mm range and the physical texel pitch. The unit normal points along `(−dh/dx, +dh/drow, 1)`. An independent calculation matched every encoded RGB channel exactly. |
| [roughness.png](roughness.png) | Binder, stone and pore sand contribute by coverage. The median roughness of pure binder is 0.792, and that of bare stone is 0.894. Sand reaches 242/255. Sealed hairlines use the smoother binder response. |
| [occlusion.png](occlusion.png) | Short horizon samples in eight opposing direction pairs measure local enclosure. The dark accents sit in chip margins and narrow recesses. Open faces reach 255 and the tile median is 238. |
| [tint.png](tint.png) | Exposed stone carries 0, pore sand 128, and binder and its thin films 255. Antialiased edges and partial films interpolate by coverage. The same coverage mixture drives roughness. |
| [material.json](material.json) | Records the 2.5 m repeat, 8 mm relief, null laying module and rounded measured sRGB mean. The surface is entirely dielectric. |

## Visual checks

| Proof | What I checked and saw |
| --- | --- |
| [Source crops](checks/sources.png) | Samples from all twelve image-tool generations before colour matching, ordered left to right by row. The exact prompt for each generation is embedded in the PNG text metadata. |
| [Photographic comparison](checks/comparison.png) | Left is the finish at one texel per pixel. Centre and right show the same 112.5 cm field width at the scan’s sampling pitch. The right column uses a CC0 road scan. Both scale-matched low-sun views use the same 15° light and an 8 mm black-to-white displacement range. |
| [Half-offset](checks/offset.png) | Shifted base, height and roughness by 1024 pixels on both axes. Grain shapes continue across the old corners. In base green, the top and left joins measure 1.01× and 0.93× the mean ordinary adjacent-pixel difference. |
| [Three repeats](checks/tiled3.png) | Full-resolution 3 × 3 assemblies, base above height. I checked both the overview and native-size join crops. I could not pick out a recurring crack, bright chip or quilt boundary. |
| [Twelve repeats](checks/tiled12.png) and [forty repeats](checks/tiled40.png) | Exact linear-light area averages produce 30 m and 100 m fields. Fine grit remains at 12 repeats. At 40, the field resolves to charcoal, with the central 98% of green values between 94 and 97. Quarter-tile source squares average 91.94–92.04 in green. |
| [Relighting](checks/relit.png) | Opposing 15° suns and a 70° sun share one exposure and the same 68.4 cm crop. Chip rims switch sides under the low lights. Mineral colour and binder films remain visible under the high sun. |
| [Registered layers](checks/layers.png) | All six maps show one 36.6 cm square and its central 12.2 cm detail. The tint boundary follows partial exposures, while the height cap continues beneath thin binder. |

## Remaining limitation

The seal material is difficult to distinguish from ordinary binder in a flat-light crop. The comparison scan also has more uneven wear between groups of stones. Its lower sampling resolution supports a comparison of grain size and packing, with finer film detail visible in the native finish crop. The lighting and distance checks were made offline.
