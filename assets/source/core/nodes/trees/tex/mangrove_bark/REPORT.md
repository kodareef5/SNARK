# Red mangrove upper bark

Complete 2048 x 2048 material set. Review [the four layers](checks/layers.jpg), [native detail and relighting](checks/detail.jpg), and [curved previews](checks/cylinders.jpg).

The design references were the repository's fig and oak trunk/lineup paintings, mangrove lineup, stumps and the [Material colours table](../../ref/concept/broadleaf/DESIGN.md). The wood-plank layer contact sheet was inspected as the delivery benchmark. No external reference search, downloaded reference image or existing game texture was used.

| Design pigment | sRGB target |
| --- | --- |
| main | `#8A8371` |
| pale | `#A99C83` |
| aged | `#655F50` |

The complete height encoding is **0 to 4 mm**: `height_u16 / 65535 * 0.004` metres. White is high. Actual authored samples occupy **0.740 to 3.137 mm**, a 2.398 mm relief span. Do not renormalize the delivered height independently of its normal.

The tile covers **1.6 m around the surface x 2.0 m along it**. Both U and V repeat. Image-up is farther from the ground. Physical pixel pitches are 1.6/2048 m and 2.0/2048 m; opposite edge texels are adjacent samples, not duplicated pixels.

## Delivered files

| File | Construction and interpretation |
| --- | --- |
| [mangrove_bark_base.png](mangrove_bark_base.png) | 8-bit RGB, embedded sRGB profile. The prescribed pale grey-brown, restrained pale dry pigment, fine aged creases and scattered lenticels. Generated botanical detail is locally contrast-bounded and recoloured around the specified swatches, without copying broad illumination. |
| [mangrove_bark_height.png](mangrove_bark_height.png) | True 16-bit greyscale PNG, linear unsigned data. Local fine fissure detection, shallow elongated folds, small generated surface detail and 25-micrometre procedural pores. Fissures were reduced after relighting to keep this smoothish bark distinctly shallower than the oak. |
| [mangrove_bark_normal.png](mangrove_bark_normal.png) | 8-bit RGB linear tangent normal, OpenGL (+X right, +Y image-up, +Z outward). Calculated **after** height quantization, at physical scale: `normalize(-dh/dx, +dh/d(image-down), 1)`. Wrapped central differences on repeating axes; second-order one-sided endpoint differences on the roots' nonperiodic Y. |
| [mangrove_bark_orm.png](mangrove_bark_orm.png) | 8-bit RGB linear: R=ambient occlusion, G=roughness, B=0 metalness. 16 azimuths and seven sample distances (1, 2, 4, 8, 16, 32, 64 px) integrate horizon visibility from the delivered height. Roughness uses surface/film/deposit fields, with range 0.733 to 0.855. |

Only base colour is decoded as sRGB. Height, normal and ORM are linear data. None of the four runtime textures contains alpha. All four share one pixel coordinate system.

## Sources and rebuilding

Two original source paintings were made with the **built-in image_gen tool**. Full prompts and the original generation locations are retained in [source/prompts.json](source/prompts.json). These frozen input pictures, rather than another image-generation request, are used for reproducible builds.

| File | How it was made / purpose |
| --- | --- |
| [source/mangrove_a.png](source/mangrove_a.png) | Unmodified full native generated PNG, 1135 x 1386. |
| [source/mangrove_b.png](source/mangrove_b.png) | Unmodified full native generated PNG, 1134 x 1387. |
| [source/composed_master_2304.png](source/composed_master_2304.png) | Nine native-resolution 1024px crops from the two paintings, with varied crop origins and flips, composed at 768px spacing. Minimum-error paths cut 256px overlaps; additional overlap cuts close both periods. The 2304px master is sampled down to 2048, then receives deterministic physical microdetail. It is a construction source, not the runtime base. |
| [source/composition.json](source/composition.json) | Source sizes and hashes, crop coordinates, flips and all nine placements, written by the build. |
| [source/prompts.json](source/prompts.json) | Exact built-in generation prompts and provenance for both native sources. |
| [source/srgb.icc](source/srgb.icc) | Frozen standard sRGB profile, initially created with Pillow/ImageCms; embedding a fixed copy keeps rebuild bytes deterministic. |
| [source/fissure_mask.png](source/fissure_mask.png) | Fine local fissure field used for shallow mangrove relief. Recreated by the build; not an additional runtime layer. |
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

The native crop has fine vertical interruptions and occasional transverse lenticels. Under the two lights it reads as shallow grey-brown bark; it does not acquire the oak's thick plates. The 3x3 and 4x8 views retain an even material value, with no large pale island, scar or hard seam drawing attention to the repeat.

PNG IHDR inspection confirmed 2048 x 2048, RGB/8-bit for base, normal and ORM, and greyscale/16-bit for height. The base alone has an sRGB profile. Metalness is zero in every pixel. The independently reconstructed normal differs by **0.1716 degrees mean, 0.2996 degrees at p99, 0.3698 degrees maximum**, consistent with RGB8 quantization.

The following mean absolute jumps compare each required join with all adjacent interior pixels along the same axis. Values use an 8-bit equivalent scale (height is divided by 257); the JSON additionally records p99 jumps and interior line statistics. A ratio near one means the join is comparable to normal texture detail, not an artificial zero-gradient border.

| Layer | Edge pair | Edge jump | Interior jump | Ratio |
| --- | --- | ---: | ---: | ---: |
| base | left / right | 2.849 | 2.846 | 1.001 |
| base | top / bottom | 2.033 | 1.972 | 1.031 |
| height | left / right | 7.877 | 7.589 | 1.038 |
| height | top / bottom | 3.639 | 3.593 | 1.013 |
| normal | left / right | 8.046 | 7.849 | 1.025 |
| normal | top / bottom | 4.018 | 4.008 | 1.003 |
| orm | left / right | 1.951 | 1.843 | 1.059 |
| orm | top / bottom | 1.317 | 1.307 | 1.007 |

| Check file | Contents and method |
| --- | --- |
| [checks/layers.jpg](checks/layers.jpg) | Four delivered layers, consistently scaled and labelled. |
| [checks/ao_roughness.jpg](checks/ao_roughness.jpg) | ORM red and green displayed separately as greyscale. |
| [checks/source_overview.jpg](checks/source_overview.jpg) | The two native source paintings, assembled master and final unlit base. |
| [checks/base_tile3x3.jpg](checks/base_tile3x3.jpg) | 3 across x 3 high base-colour repetition, inspected for seams, exposure steps and landmarks. |
| [checks/base_tile4x8.jpg](checks/base_tile4x8.jpg) | 4 across x 8 high base-colour repetition, inspected for long-range bands and visible motifs. |
| [checks/offsets.jpg](checks/offsets.jpg) | Wrap seams shifted into the middle; roots shift only horizontally. Shows all four maps. |
| [checks/relighting.jpg](checks/relighting.jpg) | Same delivered maps under upper-left and lower-right neutral lights; linear-light Lambert plus dielectric GGX preview with roughness and ambient occlusion. |
| [checks/detail.jpg](checks/detail.jpg) | Matching native 768px crops of base, height and both relights, for fine detail and registration. |
| [checks/cylinders.jpg](checks/cylinders.jpg) | Normals transformed into a cylindrical tangent frame, under the two light directions; roots use three U offsets. |
| [checks/construction.json](checks/construction.json) | Build seed, physical coverage, full/used height range and derivation metadata. |
| [checks/metrics.json](checks/metrics.json) | Independent format checks, file hashes, seam statistics, normal/height angular agreement and material measurements. |
| [checks/rebuild.json](checks/rebuild.json) | Complete PNG hash comparison against an independent build from frozen inputs. |

## Remaining limitations

The finest fissures depend on appropriate normal-map filtering at distance. The included previews verify the source maps; the game's import compression, mip generation and tonemapping were outside this folder-only task. The relief is an authored interpretation of the concepts, not measured photogrammetry. A finite tile can still be identified by deliberately matching small details across a large flat repeat sheet; the review goal here was to remove hard joins, broad repeated tone bands and conspicuous individual landmarks. No unresolved format, map-alignment or required-edge discontinuity was found.
