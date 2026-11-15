# Red mangrove prop roots / tidal band

Complete 2048 x 2048 material set. Review [the four layers](checks/layers.jpg), [native detail and relighting](checks/detail.jpg), and [curved previews](checks/cylinders.jpg).

The design references were the repository's fig and oak trunk/lineup paintings, mangrove lineup, stumps and the [Material colours table](../../ref/concept/broadleaf/DESIGN.md). The wood-plank layer contact sheet was inspected as the delivery benchmark. No external reference search, downloaded reference image or existing game texture was used.

| Design pigment | sRGB target |
| --- | --- |
| main | `#8A8371` |
| pale | `#A99C83` |
| aged | `#655F50` |
| wet | `#4D5142` |
| base | `#343F38` |
| algae | `#6D734C` |

The complete height encoding is **0 to 3 mm**: `height_u16 / 65535 * 0.003` metres. White is high. Actual authored samples occupy **0.497 to 2.406 mm**, a 1.909 mm relief span. Do not renormalize the delivered height independently of its normal.

The image spans **1.6 m around a surface x 2.2 m in world height**. **Wrap U; clamp V.** Row 0 is +2.0 m above mud, row 2047 is -0.2 m. For height `z`, image row is `(2.0-z)/2.2*2047`; with V increasing upward, `v=(z+0.2)/2.2`. The vertical normal gradient uses 2.2/2047 m per row.

The measured 50% wet boundary ranges from **0.184 to 0.313 m above mud**, or **0.384 to 0.513 m from the bottom**. Its blend is approximately 7 cm thick, with fine irregularity. [The annotated height guide](checks/height_mapping.jpg) shows the mud level and limits. Wet-band median roughness is **0.427**; dry median is **0.769**. Small mud/shell deposits are rougher than the surrounding wet skin. Top and bottom deliberately do not tile.

## Delivered files

| File | Construction and interpretation |
| --- | --- |
| [mangrove_roots_base.png](mangrove_roots_base.png) | 8-bit RGB, embedded sRGB profile. Fine dry-root skin painted in the same grey-brown palette as mangrove bark. A world-height mask blends into dark wet grey-brown and the darkest basal pigment, with sparse algae, a little dried mud and minute shell-like specks. Wet darkness is a material colour change, not a baked shadow. |
| [mangrove_roots_height.png](mangrove_roots_height.png) | True 16-bit greyscale PNG, linear unsigned data. Fine, predominantly vertical root creases, gentler folds than the trunk, 22-micrometre pores, slight mud deposition and tiny raised shell rims. There is no raised ridge at the wet/dry line: that boundary belongs mainly to colour and roughness. |
| [mangrove_roots_normal.png](mangrove_roots_normal.png) | 8-bit RGB linear tangent normal, OpenGL (+X right, +Y image-up, +Z outward). Calculated **after** height quantization, at physical scale: `normalize(-dh/dx, +dh/d(image-down), 1)`. Wrapped central differences on repeating axes; second-order one-sided endpoint differences on the roots' nonperiodic Y. |
| [mangrove_roots_orm.png](mangrove_roots_orm.png) | 8-bit RGB linear: R=ambient occlusion, G=roughness, B=0 metalness. 16 azimuths and seven sample distances (1, 2, 4, 8, 16, 32, 64 px) integrate horizon visibility from the delivered height. Roughness uses surface/film/deposit fields, with range 0.380 to 0.820. |

Only base colour is decoded as sRGB. Height, normal and ORM are linear data. None of the four runtime textures contains alpha. All four share one pixel coordinate system.

## Sources and rebuilding

Two original source paintings were made with the **built-in image_gen tool**. Full prompts and the original generation locations are retained in [source/prompts.json](source/prompts.json). These frozen input pictures, rather than another image-generation request, are used for reproducible builds.

| File | How it was made / purpose |
| --- | --- |
| [source/root_a.png](source/root_a.png) | Unmodified full native generated PNG, 1086 x 1448. |
| [source/root_b.png](source/root_b.png) | Unmodified full native generated PNG, 1254 x 1254. |
| [source/composed_master_2304.png](source/composed_master_2304.png) | Nine native-resolution 1024px crops from the two paintings, with varied crop origins and flips, composed at 768px spacing. Minimum-error paths cut 256px overlaps; additional overlap cuts close both periods. The 2304px master is sampled down to 2048, then receives deterministic physical microdetail. It is a construction source, not the runtime base. |
| [source/composition.json](source/composition.json) | Source sizes and hashes, crop coordinates, flips and all nine placements, written by the build. |
| [source/prompts.json](source/prompts.json) | Exact built-in generation prompts and provenance for both native sources. |
| [source/srgb.icc](source/srgb.icc) | Frozen standard sRGB profile, initially created with Pillow/ImageCms; embedding a fixed copy keeps rebuild bytes deterministic. |
| [source/algae_mask.png](source/algae_mask.png) | Sparse algae coverage restricted to wet, exposed root bases. Recreated by the build; not an additional runtime layer. |
| [source/barnacle_mask.png](source/barnacle_mask.png) | Minute shell-rim coverage shared by pigment, relief and roughness. Recreated by the build; not an additional runtime layer. |
| [source/fissure_mask.png](source/fissure_mask.png) | Fine local fissure field used for shallow mangrove relief. Recreated by the build; not an additional runtime layer. |
| [source/wet_mask.png](source/wet_mask.png) | World-height wetness coverage; shared by wet colour and roughness. Recreated by the build; not an additional runtime layer. |
| [build_material.py](build_material.py) | Self-contained deterministic source composition, pigment/height derivation, 16-bit quantization, normal and ORM generation. Reads this folder's material.json and source inputs only. |
| [check_material.py](check_material.py) | Independent PNG/normal/seam inspection plus visual previews; optional clean-room rebuild and byte-hash comparison. |
| [material.json](material.json) | Physical coverage, height encoding, wrap policy, swatches and random seed. |
| [requirements.txt](requirements.txt) | Versions used: NumPy 2.0.2, SciPy 1.13.1, Pillow 11.3.0, with Python 3.9.6. |

From this folder, after installing the requirements if needed:

```sh
python3 build_material.py
python3 check_material.py --rebuild
```

The default checker can be run without `--rebuild` for quicker map QA. The rebuild option copies just the scripts, configuration, two native paintings and fixed profile into a temporary subfolder under checks, rebuilds all four maps, compares complete PNG SHA-256 hashes, and removes that temporary folder. **All four delivered PNGs were reproduced byte for byte.** No network, model access or neighbouring material folder is required.

## Checks and observations

The two-across sheet joins continuously around the roots. The irregular wet line stays close to mud level, with a soft edge and sparse deposits. The curved previews show a fine pale dry surface above darker lower roots. The two flat relights retain the same waterline; the normal and height do not contain an artificial tidal ledge.

PNG IHDR inspection confirmed 2048 x 2048, RGB/8-bit for base, normal and ORM, and greyscale/16-bit for height. The base alone has an sRGB profile. Metalness is zero in every pixel. The independently reconstructed normal differs by **0.1717 degrees mean, 0.2972 degrees at p99, 0.3608 degrees maximum**, consistent with RGB8 quantization.

The following mean absolute jumps compare each required join with all adjacent interior pixels along the same axis. Values use an 8-bit equivalent scale (height is divided by 257); the JSON additionally records p99 jumps and interior line statistics. A ratio near one means the join is comparable to normal texture detail, not an artificial zero-gradient border.

| Layer | Edge pair | Edge jump | Interior jump | Ratio |
| --- | --- | ---: | ---: | ---: |
| base | left / right | 2.210 | 2.070 | 1.068 |
| height | left / right | 7.532 | 6.965 | 1.081 |
| normal | left / right | 5.304 | 5.154 | 1.029 |
| orm | left / right | 1.195 | 1.132 | 1.056 |

| Check file | Contents and method |
| --- | --- |
| [checks/layers.jpg](checks/layers.jpg) | Four delivered layers, consistently scaled and labelled. |
| [checks/ao_roughness.jpg](checks/ao_roughness.jpg) | ORM red and green displayed separately as greyscale. |
| [checks/source_overview.jpg](checks/source_overview.jpg) | The two native source paintings, assembled master and final unlit base. |
| [checks/base_tile2x1.jpg](checks/base_tile2x1.jpg) | Two roots side by side, with no invalid vertical repetition. |
| [checks/offsets.jpg](checks/offsets.jpg) | Wrap seams shifted into the middle; roots shift only horizontally. Shows all four maps. |
| [checks/relighting.jpg](checks/relighting.jpg) | Same delivered maps under upper-left and lower-right neutral lights; linear-light Lambert plus dielectric GGX preview with roughness and ambient occlusion. |
| [checks/detail.jpg](checks/detail.jpg) | Matching native 768px crops of base, height and both relights, for fine detail and registration. |
| [checks/cylinders.jpg](checks/cylinders.jpg) | Normals transformed into a cylindrical tangent frame, under the two light directions; roots use three U offsets. |
| [checks/height_mapping.jpg](checks/height_mapping.jpg) | World-height annotation over the root base, with mud and wet-line limits. |
| [checks/construction.json](checks/construction.json) | Build seed, physical coverage, full/used height range and derivation metadata. |
| [checks/metrics.json](checks/metrics.json) | Independent format checks, file hashes, seam statistics, normal/height angular agreement and material measurements. |
| [checks/rebuild.json](checks/rebuild.json) | Complete PNG hash comparison against an independent build from frozen inputs. |

## Remaining limitations

The material must be addressed by world height on the actual root mesh. Repeating it along a curved root's length would put the waterline in the wrong place. The included cylinders demonstrate the maps; they are not the final mangrove cage geometry. The relief is an authored interpretation of the concepts, not measured photogrammetry. A finite tile can still be identified by deliberately matching small details across a large flat repeat sheet; the review goal here was to remove hard joins, broad repeated tone bands and conspicuous individual landmarks. No unresolved format, map-alignment or required-edge discontinuity was found.
