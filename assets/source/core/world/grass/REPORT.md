# Miami turf

## Round three

I flattened each blade across its width and fitted its height along its length, keeping a faint midrib and a small step at overlaps. Median crosswise slope inside the living blade faces fell from 0.166 to 0.010 mm/mm. I rebuilt the normal and cavity maps from the revised height. Under opposite 15° suns, the broad faces read as ribbons. A thin highlight remains where a blade spans an open gap. [Round two and three at native scale](checks/round3.png) · [Relighting](checks/relit.png)

I lowered 26 pale blade faces to the value of nearby untreated grass. The two arms of the prominent V near the top now sit within one 8-bit luma value of their neighbours. The retouch affected 0.91% of the base pixels. Mean sRGB still rounds to (96, 108, 42). The refreshed offset and repeat sheets showed continuous joins and an even olive field at distance. [Half-offset](checks/offset.png) · [Three repeats](checks/tiled3.png) · [Forty repeats](checks/tiled40.png)

All six maps were exported together from the recovered blade layout. Roughness and tint matched round two byte for byte. An independent calculation from the saved 16-bit height agreed with the exported normal to within 0.39°. [Aligned map crop](checks/layers.png)

## Round two

I rebuilt the 2 m tile from six overcast image-tool turf studies. Their runners, leaf faces and thatch supply the understorey. A seventh generation supplied 36 isolated blade silhouettes with their own veins, tips and pigment. I placed those in small fans and fitted a separate curved surface to each blade. They cover 22% of the finished tile. The middle 80% of their projected lengths span 6.0–12.2 cm, with widths of 5.4–9.5 mm. The inputs and exact prompts are in [sources](sources/) and [prompts.md](sources/prompts.md).

In the native crop, the upper leaves have broad faces and pale midribs. Older olive blades and buff straw remain visible between them. The median height steps from 2.9 mm on exposed soil to 16.0 mm on thatch and 30.4 mm on the added blades. I corrected small pale marks that initially rendered as holes. Under the 15° sun, a few close crossings still have a thicker edge than the blades in the field photographs. The reference photographs have unrecorded camera distances and sun angles. [Field comparison](checks/reference.png) · [Generated source comparison](checks/source.png) · [Relighting](checks/relit.png)

### Round two files

| File | Construction and verification |
| --- | --- |
| [Base colour](base.png) | Rotated and bent source crops meet along low-difference paths with narrow feathering. I retained the pigment changes along each blade, filled deep source shadows, then balanced broad colour and contrast across the tile. Mean sRGB is (96, 108, 42). |
| [Height](height.png) | I separated living laminae, fibrous thatch and granular openings. Visible span, width and continuity set the layer of each grass face. Each face has its own lengthwise arch and transverse fold. The isolated upper blades intersect this terrain by elevation. The saved 16-bit map uses 0–65535 for 40 mm. |
| [Normal](normal.png) | Wrapped centred differences of the saved height use a 0.9766 mm texel pitch and OpenGL green. A second calculation from the exported PNG gave 0.17° mean and 0.385° maximum angular error after RGB quantization. |
| [Roughness](roughness.png) | Blade faces, dry fibres and soil have separate roughness values, blended by visible edge coverage. Their interior means are 0.834, 0.918 and 0.937. The map spans 204–242. |
| [Occlusion](occlusion.png) | Eight short-range horizon samples per radius attenuate gaps between layers. Interior median values are 252 on living tissue, 208 on straw and 175 on soil. The deepest crevices reach 107. |
| [Tint](tint.png) | Material coverage mixes 255 for living tissue, 100 for thatch and 0 for soil. Their area shares are 82.1%, 13.8% and 4.1%. The same coverage controls all six maps. |
| [Metadata](material.json) | Records the 2 m width, 40 mm relief, null natural module and measured mean. All six map headers passed the 2048 × 2048 format checks. |

The original four corners meet continuously in the [half-offset](checks/offset.png). The [aligned crop](checks/layers.png) shows the same blade crossings in all six maps. At [three repeats](checks/tiled3.png) the clumps remain visible. The [12×12](checks/tiled12.png) and [40×40](checks/tiled40.png) fields settle to fine olive grain. Across sixteen half-metre blocks, mean base luma ranges from 100.49 to 100.95 and mean height from 24.16 to 24.47 mm.

The field photographs are credited on the [comparison sheet](checks/reference.png).

<details>
<summary>Round one production notes, before replacement</summary>

The 2 m tile has a measured mean sRGB of **(96, 108, 42)** and **40 mm** of relief. Living plants cover 84.8% of the visible surface, straw-coloured thatch 10.4%, and sandy soil 4.9%, measured before edge antialiasing.

I built the turf from individual plants on a wrapping 4096 × 4096 surface. Short runners join groups of coarse grass shoots. Their blades emerge in pairs and fans, widen through the middle, then bend and narrow toward the tip. Finer grasses, small paired weed leaves, twisted old blades and sandy soil fill the gaps. At every sample, the uppermost surface supplies the pigment, roughness and material identity. Four samples contribute to each delivered texel.

## Material files

| File | Construction and check |
| --- | --- |
| [base.png](base.png) | Each blade has its own olive pigment, longitudinal bands, sheath colour and degree of tip bleaching. Thatch has buff fibres. The soil mixes grey-brown organic matter and fine sand grains. I averaged the subpixels in linear light, reduced broad pigment drift and calibrated the sRGB mean. The albedo uses pigment alone. In the close crop, veins and straw remain legible under either light direction. |
| [height.png](height.png) | The upper surface comes from the soil relief, curved blade centrelines, crosswise folds, ribs and twists. I integrated subpixel coverage, softened the silhouette by 0.46 texel and encoded the result across 0–65535. At pixels wholly inside each tint class, the mean elevations are 3.5 mm for soil, 15.6 mm for thatch and 25.8 mm for living tissue. The highest blade tops reach 40 mm. |
| [normal.png](normal.png) | Wrapped centred differences of the quantized height use a 0.9765625 mm texel pitch. The unit normal uses negative height slope toward image right and positive height slope toward increasing image row, giving OpenGL green toward image top. Recomputing in double precision from the saved height and comparing with the decoded RGB normal gave a mean angular error of 0.17° and a maximum of 0.385°. |
| [roughness.png](roughness.png) | Material-specific roughness follows each visible surface, with a slight increase toward dry tips. Values span 204–242. Living tissue averages 0.832, thatch 0.920 and soil 0.937. The paler filaments in the roughness crop follow exposed straw crossings. |
| [occlusion.png](occlusion.png) | I sampled the height horizon in eight directions at offsets of 1, 2, 4 and 7 texels along each direction, attenuating more distant contributions. Output spans 186–255. The strongest attenuation sits in narrow openings beside blades. Open ridges reach white. |
| [tint.png](tint.png) | Each visible subsample contributes 255 for living tissue, 100 for thatch or 0 for soil. Intermediate edge values record fractional coverage. The shared crop shows thin straw crossing dark soil gaps between the white living blades. |
| [material.json](material.json) | Records the 2 m span, 40 mm height interval and rounded mean of the exported base. The natural turf uses a null module. |

All six material images passed a PNG header check for 2048 × 2048 dimensions, channel count and bit depth. The base carries an sRGB tag. The five data maps carry a linear gamma tag.

## Inspection sheets

| Sheet | How to read it and what I saw |
| --- | --- |
| [Offset](checks/offset.png) | Each full-resolution panel wraps by 1024 texels in both directions. I inspected the old four-corner intersection at native scale. Blades and straw cross both axes continuously. Mean absolute base-luma steps across the two joins were 5.11 and 5.24 code values, close to 5.22 and 5.21 for interior steps. |
| [Three repeats](checks/tiled3.png) | The left panel repeats base colour 3 × 3 at native size. The right repeats an 8-bit display of the height at the same size. The first pass had recurring low pockets in the canopy. I spread runner starts through underoccupied ground and checked the sheet again. The revised height reads as a field of small crossings. Half-metre blocks across the final tile average 23.11–23.55 mm in height. |
| [Twelve repeats](checks/tiled12.png) | This is a 24 m square at 2048 × 2048. Every output pixel integrates a 12 × 12 source footprint in linear light across the wraps. The blades merge into lightly mottled olive. I could see fine grain, with no visible grid, diagonal band or recurring pale patch. |
| [Relighting](checks/relit.png) | Each column uses the saved normal and linear-light base with diffuse sun and uniform ambient fill. The two 15° suns are 180° apart. The third sun is at 70°. The rows show the whole tile, a native 69 cm detail and a filtered grazing view spanning roughly 2–10 m. Across the first two columns, opposite margins of the same folded blades pick up the sun. The high sun brings out their upper faces. |
| [Aligned layers](checks/layers.png) | All six panels show the same 384 × 384 texels at native scale, starting at (704, 672). The broad blade outlines can be followed from pigment through height and normal into the tint mask. Narrow soil gaps carry the roughest values and local occlusion. |

## Remaining limitation

At native scale under the 15° sun, a few overlapping blades have thick-looking rims. A single height field connects the top blade to the lower surface across about a texel. The effect is easiest to see in the middle row of the relighting sheet and subsides in the grazing view.

</details>
