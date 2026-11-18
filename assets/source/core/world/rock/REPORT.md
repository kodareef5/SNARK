# Exposed oolitic limestone

This 2048 × 2048 tile covers 3 m of weathered stone. The exposed body grades from cool grey patina into warmer calcite. Thin shell sections run through it, and small groups of solution cavities share sharp partitions. Mean base colour rounds to sRGB **(124, 124, 122)**.

## Material files

| File | Construction and checks |
| --- | --- |
| `base.png` | An 8-bit RGB albedo with an sRGB tag. Eight generated overcast views supply the cloudy stone, patina and fossil texture. I matched their exposure, reduced them from 1254 to 960 pixels, and quilted 64 disjoint crops with narrow, irregular joins that wrap across the tile edges. Inside traced openings, nearby stone pigment and grey silt replace most of the source shading. Mean luma across the 64 squares of 256 × 256 pixels ranges from 123.48 to 124.45. |
| `height.png` | A 16-bit greyscale field using 0–65535 over 30 mm. Connected aperture outlines define the pits. Wall shape and floor depth depend on distance to the rim and the aperture’s inscribed radius. Narrow shell sections have their own raised cross-section. A separately modelled worn stone surface passes beneath both. |
| `normal.png` | An 8-bit RGB OpenGL normal computed from the exported height with wrapped centred differences. Texel pitch is 1.46484 mm and positive Y points up the image. Independent decoding and comparison with the height gradients gave a maximum angular error of 0.385°. |
| `roughness.png` | An 8-bit linear map. The grey weathered surface is roughest. Shell laminae and sediment-filled cups are slightly smoother. The measured range is 217–242, or 0.851–0.949, with a mean of 0.913. |
| `occlusion.png` | An 8-bit linear map. Sixteen directions sample local horizons out to 35 mm. Opposing horizons cancel on flat, sloping stone. The darkest enclosed portions reach 74 and exposed ridges reach 255. |
| `tint.png` | An 8-bit linear mask. Deep interiors meeting both a local carving-depth threshold and a low final elevation receive 128. They cover 2.88% of the tile. The remaining stone receives 255. |
| `material.json` | Records 3 m width, 30 mm relief, null laying module and the rounded measured mean. The finish is entirely mineral. |
| `make_rock.py` and `sources/` | The deterministic builder reads the eight local ImageGen fields and reconstructs the maps and seven PNG proofs. The generation prompts are in [prompts.txt](sources/prompts.txt). |

## Visual inspection

| Proof | What I checked and saw |
| --- | --- |
| [Half-tile offset](checks/offset.png) | Base, height and roughness wrap by 1024 pixels on both axes. Grain and cavity density continue through the original edges. Mean absolute luma steps across the horizontal and vertical wrap are 6.90 and 7.01 levels, close to 6.63 and 6.80 between ordinary neighbours. |
| [Nine repeats at native resolution](checks/tiled3.png) | The left panel is 9 m square of base colour and the right panel shows the same field in height. After replacing the oversized pockets, I could no longer pick out a dark hole to follow from tile to tile. Height is displayed using its upper eight bits. |
| [12 × 12 field](checks/tiled12.png) and [40 × 40 field](checks/tiled40.png) | These represent 36 m and 120 m of stone. Each pixel averages its exact footprint in linear light. The fine mottling settles to an even grey. I saw no grid at the crop joins or line of bright specks. |
| [Full relight](checks/relit.png) and [native close-up](checks/closeup.png) | Both 15° suns and the 70° sun use the same exposure. Cast shadows and diffuse light come from the exported height. The bright wall switches sides when the sun crosses the pit. Under the high sun the thin partitions are legible against the softer, worn stone body. |
| [Aligned map crop](checks/layers.png) | Each layer shows the same 75 cm square. Grey patina extends over high stone. The smaller tint islands sit inside the occluded pits, while exposed shell sections retain full tint. |

## Round two

I replaced the stippled procedural colour with photographic texture from eight generated limestone fields. The first quilt still had eight dark openings large enough to recognize in the 3 × 3 sheet. I replaced them with unused source crops before building the relief and levelled the broadest bedrock highs. A [field comparison](checks/comparison.html) places the same native crop under each light beside an online Miami Rock Ridge photograph.

## Remaining limitation

At 1.46 mm per texel, a 2 mm pore spans only 1.37 texels. Its lip and floor can merge under the high sun. The field photograph supplies a visual reference for stone texture. Its camera distance is unknown, so it does not establish an exact two-metre match.
