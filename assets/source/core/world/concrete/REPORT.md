# Sea-air cast concrete

One tile covers 2.5 × 2.5 m. At arm’s length the surface has a chalky cement skin, short impressions from the form, and small pockets holding grains of sand and stone. At street scale the grains merge into a slightly warm structural grey. The measured mean rounds to **sRGB (137, 133, 125)**.

## Material files

All six maps were built on the same 2048 × 2048 grid. A texel spans 1.221 mm. Four 1254 × 1254 generated source plates supply the photographic paste and fines. Each quadrant is used once at native resolution. The overlaps wander across the wrap, with a narrow blend for sharp grains and a wider blend for the paste clouds. The shrinkage network, pores and grains also wrap across both axes.

| File | Construction | Export check |
| --- | --- | --- |
| `base.png` | The four plates supply cloudy cement, lime speckling and sand colour. A thin cement skin softens the finest sand in patches. The strongest pore mouths have their colour rebuilt from local paste and sediment. Small chips expose separate mineral colours and interrupted fissures retain fine dark deposits. | 8-bit RGB with an sRGB tag. Sliding a 512 × 512 window over the whole surface gives a mean luma range of 133.03–133.47 on the 8-bit scale. |
| `height.png` | Pressed paste carries shallow, locally straight fibre impressions in six headings. The source silhouettes locate 9,758 compact pore mouths and 8,577 small sand grains. Their measured footprints receive bowl or faceted-cap profiles, with depths drawn separately from their pigment. Additional tiny cast pores, grain-filled spalls and intermittent hairlines complete the surface. | 16-bit greyscale, spanning 0–65535 over 5.0 mm. The median face sits 4.36 mm above the deepest pocket. Open paste forms a continuous upper surface for height blending. |
| `normal.png` | Wrapped central differences of the **quantized height** give slopes at the physical texel pitch. With image rows increasing downwards, the encoded unit vector is proportional to `(-dh/dx, +dh/drow, 1)`. | 8-bit RGB. I decoded the saved height and recomputed all three channels independently. Every exported normal byte matched. |
| `roughness.png` | The pressed cement is slightly smoother than the chalk deposits. Broken paste has a rough edge, with smoother exposed grains inside. | Linear 8-bit greyscale, 204–242 (0.800–0.949), mean 0.881. The crop shows the roughness transitions following individual chips. |
| `occlusion.png` | Eight height-profile directions estimate the opening above each texel out to eight steps. Opposing horizons cancel on a planar slope. Deep, narrow pockets retain the strongest occlusion. | Linear 8-bit greyscale, 98–255. Open white accounts for 94.5% of texels. Even the darkest 64 × 64 window averages 251.3. |
| `tint.png` | Cement and cement-covered fines take the palette colour. Exposed grains inside spalls keep their mineral colour. Intermediate values describe fractional grain coverage at the edges. | Linear 8-bit greyscale. 99.01% of texels are solid white. Including partial texels, exposed aggregate covers 0.65% of the area. |
| `material.json` | Records the physical scale and rounded mean measured from the exported base. The irregular cast surface uses `module: null`. | Parsed and checked against the tile dimensions, height scale and measured colour. |
| `build.py` | Regenerates the maps and seven inspection sheets using a fixed seed, NumPy, SciPy and Pillow. Grain, pore and crack footprints are sampled directly at final resolution. | Ran the generator in this folder and checked the resulting PNG headers, dimensions and map registration. |
| `photo_paste.py` | Builds the periodic photographic quilt, fits the pore and grain footprints, and replaces the colour at classified pore mouths. | Source fragments retain their native texel pitch through assembly. |
| `sources/paste-1.png` through `paste-4.png` | Four independently generated square plates. Each uses the same framing and diffuse light, with different cement and fines. | Inspected the four plates before cutting them. The built-in image tool and the complete prompts are documented in [the source notes](sources/PROMPTS.md). |

The set uses the dielectric material path throughout. All scalar maps and the normal map carry linear data.

## Inspection sheets

| Sheet | How to read it and what I saw |
| --- | --- |
| [Offset](checks/offset.png) | Base, height and roughness, left to right. Each panel is shifted 1024 texels on both axes. The old corner lies at the centre of each panel. The mottling and pore density carry across it. Base-colour steps across the horizontal and vertical wraps measured 1.02× and 0.94× the corresponding interior RMS step. |
| [Three repeats](checks/tiled3.png) | Two native-resolution 6144 × 6144 fields, base on the left and height on the right. The height preview maps all 16 bits to the display range. I inspected the field and the joins. Pores remained scattered, with no chip or crack prominent enough to mark the spacing. |
| [Twelve repeats](checks/tiled12.png) | A 30 m square filtered in linear light to 2048 × 2048. The individual mottles merge at street scale. The green-channel standard deviation is 4.59 code values. |
| [Relighting](checks/relit.png) | Three copies of the full tile, lit in linear light using the height-derived normals and the same ambient fill. The first two suns are 15° high and 180° apart. The third is 70° high. The bright lip of a pore changes sides under the low suns. The high sun brings the chalk and mineral flecks forward. |
| [Registered layers](checks/layers.png) | The same 384 × 384 crop starts at texel (704, 880) in every map. The dark islands in tint pick out exposed aggregate within the chips. Ordinary pinholes stay tintable. I also verified each panel directly against its source pixels. |
| [Forty repeats](checks/tiled40.png) | A 100 m square reduced to 2048 × 2048 with a periodic low-pass filter in linear light. The field reads as one warm grey. The green-channel standard deviation is 1.62 code values. |
| [Paste retouch](checks/comparison.png) | The same 288 × 288 crop around the upper-edge fork in rounds two and three, first in base colour and then under the same 15° sun. The crop wraps around the top edge and is shown at 1:1. Individual grains are still visible where the pale arms used to connect. |

## Close-up limit

The smallest 1 mm pinholes are narrower than a texel. They read as small changes in the raking light. The wider mouths show a distinct lip and floor. The finest filled cracks are also hard to follow under overhead light. I kept them faint because a more legible continuous crack would make the repeated slab easier to recognize.

## Round two

I replaced the procedural paste colour with the four-plate quilt, strengthened the dirt inside pinholes and gave the paste a 2–10 cm mottle. The form imprint now consists of short, straight fibres with very low relief. The opposing suns reveal pore lips and small aggregate faces without drawing curls across the paste.

The scan comparison led me to soften sand under intact cement and break up more of the hairlines. The finished tile still reads chalkier and more granular than this particular cast wall. The offset and distance sheets show an even field, and recomputing the normals from the final 16-bit height reproduced every exported byte.

## Round three

I broke up the pale paste forks with small samples of nearby mottle, then inspected the 3 × 3 field. The brightest upper-edge Y now reads as separate flecks. Across a 7 cm crop there, the contrast between the original pale arms and adjacent paste fell from 14 to 5 luma levels. I checked the same pixels before and after with a 3-texel Gaussian filter.

The edit touched 6.03% of the base-colour texels. The pore, grain, chip and crack masks protected their colour, and all five companion maps matched the round-two files byte for byte.
