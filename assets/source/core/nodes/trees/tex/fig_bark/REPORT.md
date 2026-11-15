This is the replacement strangler-fig and banyan material: four aligned **2048 × 2048** PNGs covering **1.6 m around the stem × 2.0 m along it**, repeating in both axes. Image-up points farther from the ground. Start with [the layers](checks/layers.jpg), [native detail](checks/detail.jpg), and the distance crops for the [1.8 m trunk](checks/cylinder_1.8m_native_crops.jpg) and [0.4 m pillar](checks/cylinder_0.4m_native_crops.jpg).

The base averages **(150.000, 150.000, 138.000)** in sRGB code values. Its RGB standard deviations are **(16.37, 15.14, 15.10)**; maxima are **(190, 185, 165)**. Warm cream-grey, cool old grey, scattered olive film and narrow drainage stains provide the broad variation. Fine horizontal lenticels, gathered transverse wrinkles, pale lobed lichen and small healed marks provide the close detail. Four unique source paintings each occur once in the tile; there are no reused crops or mirrored internal repeats.

The reference review covered the supplied `lineup_banyan.jpg` and `game_near_fig_2.jpg`, then `fig_trunk.png`, `fig_lineup.png`, `banyan_lineup.png` and `banyan_hall.png`. The wood material's layer contact sheet and the remade oak material and construction were also reviewed. The game views were diagnostic only. No external image search, downloaded reference or existing-game texture was used.

| Runtime file | How it was made | Checks and observations |
| --- | --- | --- |
| [fig_bark_base.png](fig_bark_base.png) | RGB8 with fixed embedded sRGB ICC profile. Four generated fig-skin originals are joined with minimum-error overlaps. Broad pigment, chroma and fine anatomy are separated; periodic weathering fields add larger variation. Algae follows green source pigment, and dampness follows narrow source drainage channels. A soft colour shoulder retains detail near the ceiling; the final mean is calibrated after all pigment operations. No AO, rendered light or specular pass is multiplied into the base. | Checked mean, spread, extrema, seams, 3×3 and 4×8 repeats, native detail and all distance views. Broad patches remain visible at 10–30 m. Fine lichen and wrinkles stay subordinate. Sparse film weight exceeds 0.2 on **1.43%** of the surface; damp weight exceeds 0.2 on **2.06%**. |
| [fig_bark_height.png](fig_bark_height.png) | True unsigned greyscale16. Smooth periodic vertical folds carry the broad relief. Anisotropic source residuals supply smaller wrinkles and crease bunches; the finest skin residual supplies shallow lenticels and scar/lichen relief. Large pigment islands are not directly converted into large lumps. | Full encoding and actual occupied range are **0–18 mm**, white high. Checked PNG bit depth, endpoints, wrap continuity, native registration and constant-pigment relighting. Side lighting reveals soft folds; the surface remains smooth fig skin. |
| [fig_bark_normal.png](fig_bark_normal.png) | RGB8 linear, tangent-space **OpenGL**. Calculated from the exact quantized height samples with wrapped central differences at physical pixel pitch. No arbitrary normal-strength multiplier. | Independent reconstruction from the delivered height gives **0.1717° mean**, **0.2993° p99**, **0.3726° maximum** angular error, consistent with RGB8 quantization. Median surface slope is **7.39°**. Tangent-frame mapping was checked on both cylinders. |
| [fig_bark_orm.png](fig_bark_orm.png) | RGB8 linear: **R occlusion, G roughness, B metalness zero**. AO integrates height horizons in 16 azimuths at seven radii, with additional local geometric-concavity attenuation. Roughness follows substrate, film, moisture and lichen. | AO is **0.600–1.000**; median **0.992** overall and **0.824** in the crease mask above 0.3. Authored roughness is **0.80–0.92**, encoded as **204–235 / 255** (0.800–0.92157; nearest-byte rounding). Damp median is **0.831**, dry median **0.886**. Metalness is zero in every pixel. |

Height conversion is `height_u16 / 65535 × 0.018` metres. Physical texel pitches are **0.78125 mm across** and **0.9765625 mm along**. The normal formula is `normalize(-dh/dx, +dh/d(image_down), 1)`: red right, green image-up, blue outward. Use normal strength 1, repeat addressing in U and V, and sRGB decoding only for base colour. Height, normal and ORM are linear data. Opposite border texels are adjacent periodic samples, not duplicated border pixels.

| Source or build file | Purpose |
| --- | --- |
| `source/fig_skin_a.png`, `fig_skin_b.png`, `fig_skin_c.png`, `fig_skin_d.png` | Four unchanged full native **1254 × 1254** PNGs made with the **built-in image_gen tool**. Prompts requested 2048, but 1254 is the actual returned size. All originals are retained. |
| [source/prompts.json](source/prompts.json) | Exact final prompt set, tool provenance, requested sizes and actual sizes. No image generation is required for a rebuild. |
| [source/periodic_master.png](source/periodic_master.png) | Rebuilt 2048px construction source. Four originals at 1024px spacing with 230px minimum-error overlaps, then both periodic closures. The final cut has cyclic endpoints. No source upscaling or repeated crops. |
| [source/composition.json](source/composition.json) | Rebuilt source hashes, sizes, placements, horizontal flips and periodic offset. |
| `source/fold_crowns.png`, `crease_mask.png` | Rebuilt aligned broad-fold and geometric-concavity fields. |
| `source/film_mask.png`, `damp_mask.png`, `lichen_mask.png` | Rebuilt aligned pigment and roughness masks. They are construction aids, not additional runtime textures. |
| [source/srgb.icc](source/srgb.icc) | Reused fixed standard sRGB profile, embedded only in colour pictures. |
| [build_material.py](build_material.py) | Complete deterministic offline composition, pigment, height, normal and ORM build. Reads only this folder's manifest, four frozen source PNGs and fixed profile. |
| [check_material.py](check_material.py) | Independent PNG, normal, seam and material measurements; repeat sheets; physical-scale software renders; isolated rebuild and SHA-256 comparison. |
| [material.json](material.json) | Version 2 manifest with physical scale, height encoding, colour spaces, palette, ranges, seed, source files and preview settings. |
| [requirements.txt](requirements.txt) | NumPy 2.0.2, SciPy 1.13.1 and Pillow 11.3.0; verified with Python 3.9.6. |

Rebuild and check from this folder:

```sh
python3 build_material.py
python3 check_material.py --rebuild
```

`python3 check_material.py --no-render` runs the numerical checks and static material sheets without the distance renders. The full `--rebuild` run copies only the required frozen inputs into a temporary folder beneath `checks/`, rebuilds the material, compares the complete PNG hashes, and removes the temporary folder. **All four runtime maps rebuilt byte-for-byte.** All eleven material assertions passed. Results are in [metrics.json](checks/metrics.json) and [rebuild.json](checks/rebuild.json).

The seam measurements below compare each wrap jump with ordinary adjacent interior pixels along the same axis. Values are in 8-bit-equivalent units; height is divided by 257. The JSON also records p99 jumps and each seam's percentile among interior lines. The joins are comparable to ordinary texture detail, and the offset/repeat views show no hard border.

| Layer | Join | Edge mean jump | Interior mean jump | Ratio |
| --- | --- | ---: | ---: | ---: |
| base | left / right | 2.084 | 1.763 | 1.182 |
| base | top / bottom | 2.031 | 2.105 | 0.965 |
| height | left / right | 1.360 | 1.315 | 1.035 |
| height | top / bottom | 1.047 | 1.143 | 0.916 |
| normal | left / right | 4.471 | 4.304 | 1.039 |
| normal | top / bottom | 4.384 | 4.903 | 0.894 |
| orm | left / right | 0.998 | 1.030 | 0.968 |
| orm | top / bottom | 0.985 | 1.269 | 0.776 |

| Check artifact | What was checked and observed |
| --- | --- |
| [checks/layers.jpg](checks/layers.jpg) | Four consistently scaled, labelled delivered maps. Fine anatomy registers between colour, height and normal. |
| [checks/ao_roughness.jpg](checks/ao_roughness.jpg) | ORM red and green separately. Creases receive occlusion; wet/filmed skin is slightly smoother. |
| [checks/source_overview.jpg](checks/source_overview.jpg) | Four original native source paintings. |
| [checks/base_tile3x3.jpg](checks/base_tile3x3.jpg), [native PNG](checks/base_tile3x3_native.png) | Three across by three up. Native file is 6144px square for one-to-one inspection. No straight join or square exposure boundary. |
| [checks/base_tile4x8.jpg](checks/base_tile4x8.jpg) | Four across by eight up. Broad mottling remains varied; no large scar or lichen emblem dominates. The finite repeat is still findable by deliberate pattern matching. |
| [checks/offsets.jpg](checks/offsets.jpg) | All four maps shifted half a period in both axes. No isolated wrap line. |
| [checks/relighting_flat.jpg](checks/relighting_flat.jpg), [detail.jpg](checks/detail.jpg) | Entire tile under front and side low suns; corresponding 768px native crops show local folds and fine anatomy. |
| [checks/geometry_only.jpg](checks/geometry_only.jpg) | Constant pigment with delivered normal and ORM. Confirms that the relief comes from height and normal, independently of pigment. |
| [checks/flat_distances.jpg](checks/flat_distances.jpg), [native crops](checks/flat_native_crops.jpg) | A 1.6 m wide, 4 m tall flat surface at 3, 10 and 30 m, each under front and side sun. |
| [checks/cylinder_1.8m_distances.jpg](checks/cylinder_1.8m_distances.jpg), [native crops](checks/cylinder_1.8m_native_crops.jpg) | A **1.8 m diameter** cylinder at all three distances under both suns. At 3 m the fine skin is legible; at 10–30 m the cream/cool-grey pattern and drainage stains carry the material. |
| [checks/cylinder_0.4m_distances.jpg](checks/cylinder_0.4m_distances.jpg), [native crops](checks/cylinder_0.4m_native_crops.jpg) | A **0.4 m diameter** pillar at all three distances under both suns. It retains uneven living colour at 30 m; tiny lenticels appropriately filter away. |
| `checks/flat_{3,10,30}m_{front,side}.jpg`, `checks/cylinder_{1.8,0.4}m_{3,10,30}m_{front,side}.jpg` | All **18 individual 1920 × 1080** perspective views. The braces describe the filename combinations. Native crop sheets preserve screen pixels without enlarging the far objects. |
| [checks/construction.json](checks/construction.json) | Construction methods, drainage-filter scale, physical range and source sizes. |
| [checks/metrics.json](checks/metrics.json), [checks/rebuild.json](checks/rebuild.json) | Formats, hashes, seam distributions, height/normal agreement, colour statistics, mask coverage, roughness/AO, assertions and byte-identical rebuild evidence. |

Every distance render uses **60° horizontal FOV**, a **1920 × 1080** viewport and a camera height of **1.6 m**. Distance is to the closest/front surface. Cylinders are 4 m tall, with no silhouette displacement. Their circumference repeats are approximately 3.534 for the large cylinder and 0.785 for the thin pillar. The sun is **18° above the horizon**, at **0° front** or **75° side** azimuth. There is one sun plus uniform sky, **no cast shadows and no bounced light**. Sky and sun irradiances sum to approximately one for a sun-facing surface, keeping it close to the base colour. AO affects the sky term only. Rough dielectric GGX consumes the roughness channel. Exposure is fixed, without tone mapping. Rendering uses 2× supersampling, periodic trilinear mipmaps, linear-light colour filtering, and decoded/renormalized normal filtering.

I would ship this texture set. Remaining limits: these are controlled software previews, not the game's actual shader, UVs or compressed textures. The height is authored relief, not a measured scan; it cannot create fused-root silhouettes or place a crease at a particular model's fork. Broad folds are procedural and fine relief is reconstructed from the paintings. The generated fine-scale light/dark residual is suppressed, but pigment/relief separation is an authored approximation rather than a calibrated scan. At 30 m the 0.4 m pillar is only about 22 screen pixels wide, so only its broad colour variation survives. Deliberate matching can still reveal a finite repeating tile; no conspicuous isolated landmark or hard seam remained in review.

The first set's unused `fig_a.png`, `fig_b.png` and old generation prompts were removed. Its runtime maps, scripts, manifest, film mask and report were replaced. The fixed sRGB profile and pinned requirements were reused. No old diagnostic output is retained. `BRIEF.md` and the supplied in-game picture, now `feedback/round1_game_near.jpg`, remain as task/reference inputs.
