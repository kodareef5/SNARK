**The four final layers are complete, pixel-aligned at 2048 × 2048, and pass the independent checks.** The frozen sources rebuild the deliverables byte for byte. Start with [checks/layers.jpg](checks/layers.jpg) for the complete set and [checks/base_over_layout.png](checks/base_over_layout.png) for registration.

The full height encoding range is **48 millimetres**: black is 0 mm, white is 48 mm, and the nominal surface is 24 mm (approximately 0.5). The atlas actually occupies 8.843–31.444 mm. Do not normalize the occupied values to 0–1: that would change the physical strength. For centred displacement, use `(height / 65535 - 0.5) * 0.048` metres. The car apertures encode a shallow recess for surface shading; they do not attempt to encode the full cabin depth.

| Deliverable | Encoding and construction |
| --- | --- |
| [ruins_base.png](ruins_base.png) | 8-bit RGB, sRGB with an embedded frozen standard ICC profile. Five original generated paintings assembled into the supplied regions, colour finishing, narrow wrap repairs, subdued source microcontrast, and deterministic fine pigment variation. Window interiors replaced with flat dark absorptive colour. No relighting or computed AO is multiplied into this file. |
| [ruins_height.png](ruins_height.png) | True 16-bit single-channel grayscale PNG, linear. Material-specific shallow pitting, flake relief, locally detected concrete chips and cracks, explicitly registered capital moulding, bolt holes, step relief, glass edges, tyre decay, body dents and pressure scars. Broad damp and paint colour are not interpreted as macro-height. |
| [ruins_normal.png](ruins_normal.png) | 8-bit RGB linear data, **OpenGL +Y toward image top**. Central differences of the delivered quantized 16-bit height, using the separate horizontal and vertical physical pixel pitches below. Each island is differentiated independently; pole, post and car wrap horizontally; all other boundaries clamp. |
| [ruins_orm.png](ruins_orm.png) | 8-bit RGB linear data. R is multiscale cavity AO calculated from height at 1.5, 5 and 16 mm neighbourhood radii. G is material roughness. B is surviving-metal coverage: bare steel 0.549, residual zinc 0.580, all rust, paint, concrete, lichen, glass, rubber and apertures zero. |

`ruins_base.png` is the only sRGB texture. Import height, normal and ORM as linear data; keep the height at 16-bit. All final files have RGB or grayscale channels only, with no alpha. The packed atlas has the exact supplied boundaries and no extra gutters.

The sign's two 384 × 768 halves each cover **0.75 × 0.45 m**. The 0.75 m in the layout describes one sign face, not the combined front/back strip; giving the combined strip that width would double the normal strength horizontally. The car covers the supplied 5 m circumference × 4 m length.

| Island | mm/pixel across | mm/pixel down | Encoded heights used, mm |
| --- | ---: | ---: | ---: |
| column | 0.878906 | 2.197266 | 8.843–31.444 |
| pole | 1.835938 | 2.929688 | 14.000–27.623 |
| post | 0.976562 | 1.708984 | 22.933–24.934 |
| sign_front | 1.953125 | 0.585938 | 17.000–24.898 |
| sign_back | 1.953125 | 0.585938 | 17.000–24.860 |
| car | 6.510417 | 3.125000 | 9.000–24.983 |

For a height field in millimetres, the normal is `normalize(-dh/dx, +dh/dy_image, 1)`. The positive second term accounts for image rows increasing downward while the tangent Y axis points upward. Normal computation happens after height quantization, not from a separate floating-point working height.

The column has its complete capital in rows 0–272, followed by a quieter shaft with restrained cracks, chipped arrises, thin exposed iron and increasing damp. Its details are distributed rather than concentrated in a central emblem. The pole has two old bolt sites, a broken step, mineral pores and lower lichen. The post retains a damaged zinc band. The sign keeps a faded green band and eroded arrow on the front, and plain oxide with exactly two bolt holes on the back. The car keeps four dark window openings within the two guide bands, glass teeth, worn tyres, door seams, muted coating remnants and an uninterrupted underside join. No lettering, logo, brand, actual tree roots or borrowed game imagery appears in the texture.

The sources were made with the **built-in image generation tool**, not a CLI/API fallback. The local concept paintings and `DESIGN.md` supplied the art direction; no web search, downloaded reference, or existing game's picture was used. The column, pole, post and sign originals are 1254 × 1254. The car original is 971 × 1619. Each is preserved unchanged in [source/](source/). The three tall pieces use both halves of their source paintings, joined through a 128-row overlap; this preserves more native vertical detail than enlarging a single square atlas. The capital is registered separately. `source/assembled_master.png` preserves the 2048 × 2048 composition before finishing. Exact prompts are in [source/prompts.json](source/prompts.json) and [source/car_prompt.txt](source/car_prompt.txt); the latter used only the cropped supplied car guide as an image input. `source/srgb.icc` freezes the standard colour profile so its creation timestamp cannot change rebuilt PNG hashes.

Rebuild from this folder with Python 3 and the pinned packages in [requirements.txt](requirements.txt):

```sh
python3 build_material.py
python3 check_material.py --rebuild
```

[build_material.py](build_material.py) builds every final layer and the assembled master without network access or further image generation. [check_material.py](check_material.py) reads the saved PNGs, independently recomputes physical normals, validates formats and masks, measures joins, and regenerates the visual checks. `--rebuild` compares complete PNG SHA-256 values across a fresh build. The final run passed and all four files were byte-identical.

| Check | Observation |
| --- | --- |
| [layers.jpg](checks/layers.jpg) | Concrete, corroded pipe, sign and car remain distinct. Relief is much shallower on rust and metal than on damaged concrete; the height preview intentionally uses the actual full 48 mm range. |
| [base_over_layout.png](checks/base_over_layout.png) | Every pixel belongs to one region, without overlap or uncovered pixels. The capital stops at the marked division. Windows occupy their blue bands and the four tyres overlap their red guide positions. |
| [pole_tile2x.png](checks/pole_tile2x.png), [post_tile2x.png](checks/post_tile2x.png), [car_tile2x.png](checks/car_tile2x.png) | Inspected at native scale. No isolated straight seam at the centre; weathering and underside texture continue across the circumference join. These repeat only to expose the join, not because the asset is intended to tile repeatedly. |
| `pole_wrap_layers.jpg`, `post_wrap_layers.jpg`, `car_wrap_layers.jpg` | Four-layer wrap comparisons, including the normal and ORM seams. The dark car underseal is dielectric, avoiding spurious metallic speckle at the join. |
| [details.jpg](checks/details.jpg) | Capital damage, damp, pole step, zinc and car glass have aligned colour/height/normal/ORM treatment. |
| [sign_physical_aspect.jpg](checks/sign_physical_aspect.jpg) | Both faces checked at 0.75:0.45 proportions. The arrow reads as eroded paint; no letters survive. Exactly two connected bolt openings on each face. |
| [relighting.jpg](checks/relighting.jpg) | Opposed diagnostic lights show the physical relief changing direction. These are preview images only, not baked lighting in the delivered base. |
| [metrics.json](checks/metrics.json) | PNG headers, bit depths, colour profiles, hashes, coverage, material statistics, feature coverage, independent normal errors, and full seam distributions. All assertions pass. |
| [construction.json](checks/construction.json), [material_ids.png](checks/material_ids.png) | Source hashes, physical calibration, construction seed and diagnostic material classes. IDs 1–9 are documented in the JSON; this mask is not needed by the runtime material. |

Mean absolute wrapping-edge jump divided by the mean absolute adjacent-pixel difference inside the same region, across all channels:

| Region | Base | Height | Normal | ORM |
| --- | ---: | ---: | ---: | ---: |
| pole | 1.097 | 1.219 | 1.118 | 1.186 |
| post | 1.007 | 1.008 | 1.040 | 1.046 |
| car | 1.197 | 0.649 | 0.752 | 0.454 |

These joins use consecutive source samples, not identical endpoint columns or a painted flat stripe. JSON also records the 95th/99th percentiles, per-channel values, interior column distributions and the adjacent 20-pixel bands, so the averages are not the sole evidence.

Normal-versus-delivered-height angular error: mean **0.1750°**, 99th percentile **0.3178°**, maximum **0.3819°**. This is consistent with quantizing a unit normal into RGB8. Explicit analytic ramps separately confirm the OpenGL green sign and horizontal red sign. The height contains **22,161** distinct values. Mean roughness is 0.852 for concrete, 0.804 for rust and 0.499 for surviving steel. There is no metalness leakage into rust or paint.

The right and left window guide bands are respectively 77.9% and 75.5% dark openings; their remaining area includes corroded frames, the door division and broken glass. Rubber covers 60.7–66.8% of the marked wheel boxes, with rusty hubs occupying the remainder.

I would ship these maps for the specified few-metre viewing distance. The remaining limitations are the ordinary ones of this texture deliverable: the car's crushed silhouette, capital's missing corner and real open-window geometry must come from the mesh; the height is local surface relief, not a substitute for those shapes. The generated paintings retain some illustrative crevice contrast around flakes and moulding, so this is an authored environment albedo rather than measured reflectance. Actual engine lighting, UV tangents and mip filtering were not available for inspection here. Because the requested layout has no gutters, engine sampling and mip generation must respect the individual islands. No changes outside this folder were made to integrate or test the meshes.
