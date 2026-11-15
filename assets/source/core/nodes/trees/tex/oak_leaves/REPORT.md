Round 6 brightens the existing live-oak sprays: **cells 0/2 average 150/152/76**, **cells 1/3 average 96/108/64**, and cell 2's fresh tips reach **185/182/92** at the 95th percentile. Start with [the four cells](checks/clusters.png), [the game-tint preview](checks/spray_tint_preview.png), and [the layers](checks/layers.jpg).

The supplied game comparison and [oak lineup concept](../../ref/concept/broadleaf/oak_lineup.png) establish the brightness problem; the [current crown atlas](../oak_crown/oak_crown_base.png) supplies the opaque heads edged by these sprays. This round changes only the four cards' RGB and their nearest-leaf colour padding. Every alpha value, the mass, both accessory strips, and the complete height, normal and ORM PNGs remain unchanged from round 5.

| Region | Target mean RGB | Delivered mean RGB |
| --- | --- | --- |
| Cell 0 / sun | 150, 152, 76 | 150.00, 152.00, 76.00 |
| Cell 1 / shade | 96, 108, 64 | 96.00, 108.00, 64.00 |
| Cell 2 / sun, fresh growth | 150, 152, 76 | 150.00, 152.00, 76.00 |
| Cell 3 / shade | 96, 108, 64 | 96.00, 108.00, 64.00 |
| Interior mass / retained | 66, 78, 48 | 66.00, 78.00, 48.00 |

These are arithmetic sRGB means over pixels surviving alpha cut 0.5, including the unchanged visible twigs and brown leaves. Each card is within **0.004 code value** of its target in every channel. Mature sun leaves reach channel maxima **182/179/90**; fresh growth averages **183.00/180.00/89.99**, with its 95th-percentile channels **185/182/92**, above both mature sun populations. Fresh growth and brown leaves still occupy **2.12% and 1.18%** of cell 2. Their shapes and positions are unchanged; twig and brown-leaf colours are also unchanged.

[build_material.py](build_material.py) changes the existing ecotype targets and pigment ceilings. Additive calibration retains the darker and lighter faces within each spray, with the existing fine tissue retained. It adds no directional illumination. Measured on the same visible mature leaves before and after, brightness-rank correlations are **0.999987, 0.999987, 0.999970 and 0.999975**. The 90th-minus-10th-percentile luminance spread retains **100.02%, 100.00%, 100.02% and 100.29%** of its round-5 value. The new brightness comes without flattening the spray's internal value structure.

The game's **linear RGB multiplier 0.96/1.0/0.72** remains an engine operation. The tint preview decodes the saved sRGB colours, multiplies in linear space, then encodes back to sRGB. Before illumination, the resulting sun-card mean is about **147.23/152.00/64.48**, and the shade-card mean about **94.14/108.00/54.02**. This warmer tint is **not baked into the delivered atlas**.

| Delivered file | Construction and preservation |
| --- | --- |
| [oak_leaves_base.png](oak_leaves_base.png) | 2048 × 2048, straight 8-bit RGBA, tagged sRGB. Rebuilt from the retained generated tissue and deterministic composition with revised card pigments. RGB changes are confined to the top-left 1024 × 1024 quarter, including transparent colour padding. Alpha, mass and both strips are pixel-byte-identical to round 5. |
| [oak_leaves_height.png](oak_leaves_height.png) | 2048 × 2048, linear 16-bit grayscale, **black 0 mm, white 160 mm**. Entire file byte-identical to round 5. |
| [oak_leaves_normal.png](oak_leaves_normal.png) | 2048 × 2048, linear RGB, OpenGL tangent convention `(-dH/dx, +dH/drow, 1)`, normalized at each region's physical pixel pitch. Derived from the saved height. Entire file byte-identical to round 5. |
| [oak_leaves_orm.png](oak_leaves_orm.png) | 2048 × 2048, linear RGB: occlusion, roughness, zero metalness. Entire file byte-identical to round 5, including all mass occlusion. Oak roughness remains about 0.95, twigs 0.85, moss 0.95, fern 0.92. |

Before the edit, the original builder reproduced all four incoming PNGs exactly. The [round-5 preservation reference](source/round5_preservation_reference.json) records those incoming hashes, protected region hashes, complete composition hash and per-leaf brightness measurements. **13 new preservation comparisons pass**, alongside the earlier preservation checks: alpha; mass and accessory base pixels; fixed twig/brown colours; complete height, normal and ORM files; layout and guide; material/leaf IDs; fern composition; and the entire recorded leaf/mass composition, including its original authored colours. Pigment calibration remains separate from that composition. All physical sizes, placements, tilts, supports, hollows and margins therefore retain their previous values.

All **249 assertions pass** in [metrics.json](checks/metrics.json). The existing checks cover formats, colour tags, padding, margins, cell reach, gaps, connectivity, botanical construction, colours, fresh tips, occlusion, roughness, metalness, normals, tiling, accessory scale and the purpose render. Added checks cover the round-5 invariants, highlight targets and retained value structure. Normal/height disagreement remains at most **0.384°**. Mass tiling and pooled shade are unchanged: base seam-energy ratios remain **1.329 horizontally / 0.959 vertically**, and **39.58%** of the mass remains below 0.60 AO.

Each card remains **512 × 512 pixels / 0.9 × 0.9 m**, with **258/258/258/172** authored blades. Leaf sizes remain 80–120 × 40–60 mm and tilts 20–50°. Forbidden 12-pixel gutters contain zero alpha. Coverage and connectivity are exactly unchanged at every reduction, using ordinary area filtering and alpha cut 0.5 without coverage correction. Convex-outline coverage, including the attachment:

| Resolution / shrink | Cell 0 | Cell 1 | Cell 2 | Cell 3 |
| --- | --- | --- | --- | --- |
| 512 / 1× | 79.77% | 77.64% | 80.89% | 76.88% |
| 256 / 2× | 79.87% | 77.70% | 80.91% | 76.85% |
| 128 / 4× | 79.98% | 77.74% | 81.02% | 76.89% |
| 64 / 8× | 80.13% | 77.29% | 81.36% | 76.77% |
| 32 / 16× | 80.73% | 77.37% | 80.58% | 76.84% |

Review outputs were regenerated: [layout overlay](checks/base_over_layout.png), [alpha](checks/alpha.png), [margins](checks/alpha_margins.png), [grey mips](checks/mips_grey.jpg), [sky mips](checks/mips_sky.jpg), [opposing-light relighting](checks/relighting.jpg), [leaf detail](checks/leaf_detail.jpg), [accessories](checks/accessory_detail.jpg), [2 × 2 mass tile](checks/mass_tiled_2x2.png) and [half-period offset](checks/mass_offset.png). The supplied feedback crop is a JPEG in this checkout; the checker and rebuild verifier now reference that existing file correctly.

The [distance diagnostic](checks/purpose_distance.jpg), [30 m comparison beside the concept](checks/purpose_30m_concept_metric.png), [larger comparison](checks/purpose_30m_concept_comparison.png) and [sparse four-card test](checks/purpose_30m_sparse_both_lights.png) were rerun under front and high rear sun. The historical test retains its 2.4 × 1.5 m closed mass shell, fourteen separately filtered 0.9 m cards, rounded macro normals and rotated delivered detail normals, at 5, 30 and 60 m. Its 1920-pixel / 90° horizontal-FOV / 30 m frame is **96 × 67 pixels**, with a frontal card **28.8 pixels** wide. The sparse version uses one of each cell; an additional 1600-pixel viewport is retained.

| 30 m diagnostic light | Sun tops / shade rims | Sun tops / exposed interior |
| --- | --- | --- |
| Front sun | 1.67× | 2.75× |
| High rear sun | 1.41× | 2.17× |

The brighter tops remain distinct at the true 30 m reduction. The unchanged dark interior gives them more separation, while fresh tips remain localized within cell 2. The backlit core still receives zero direct sun. The concept retains stronger golden highlights and bluer shade; the backlit diagnostic remains subdued and individual leaves merge at small sizes.

**These are material diagnostics, not new game captures.** The historical card-over-mass test uses the lower-half mass and its original untinted lighting calculation; it does not reproduce the current `oak_crown` core, the complete game's crown arrangement, compression or lighting. The new tint sheet isolates the supplied material multiplier. This round therefore verifies the requested texture targets and preservation, without claiming a new measured brightest-tenth crown result in the game. The concept's art-scale registration remains approximate because it has no camera metadata.

[build_material.py](build_material.py) rebuilds offline from the retained full-size generated leaf, moss and fern sources. [composition.json](source/composition.json) records the unchanged composition and new pigment parameters; original prompts remain beside their reused sources. [check_material.py](check_material.py) regenerates the measurements and review images. [verify_rebuild.py](verify_rebuild.py) repeats both and compares all four delivered PNG hashes. Dependencies remain pinned in [requirements.txt](requirements.txt).

```sh
python3 -B build_material.py
python3 -B check_material.py
python3 -B verify_rebuild.py
```

The superseded base, composed master, pigment metadata, scripts, report and review outputs are replaced in place. All generated sources are reused; briefs, feedback, guides, historical preservation records and runner records remain. No working image variants are retained. [cleanup_manifest.json](source/cleanup_manifest.json) records replacements and prior cleanup history. The independent rebuild reproduced **all four delivered PNGs byte for byte**, with **249 checks passing again**. Results are recorded in [rebuild_verification.json](checks/rebuild_verification.json), with the complete [run log](checks/rebuild_run.log).

Import only base colour as sRGB; keep alpha cut **0.5**, height range **160 mm**, and mass repetition inside its existing lower-half rectangle.
