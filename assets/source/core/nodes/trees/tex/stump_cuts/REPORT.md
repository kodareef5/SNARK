**Round 2 — 14 November 2026.** Replaced all four delivered layers, retaining the **2048 × 2048** layout, **819.2 px** disc diameters, physical scales, design colour swatches, exterior bark colours, fig concrete and approved torn hinges. The original round-one report is retained below as history; this addition describes the current files.

Review [before and after](checks/round2_before_after.jpg), [the supplied concept beside the revised materials](checks/concept_comparison.jpg), [the four layers](checks/layers.jpg), and [opposing-light renders](checks/relighting.jpg). Native-size species renders and [neutral-grey relief](checks/relief_clay.jpg) are also regenerated in `checks/`.

| Replaced file | Round-two changes |
| --- | --- |
| [stump_cuts_base.png](stump_cuts_base.png) | Fine, eccentric growth arcs now cross the wood and change position at facet boundaries. Their value variation is strongest on oak sapwood and subtler on soft fig. Six complete facets have separate, restrained reflectance tones; paler cuts also have lower roughness. Oak heartwood is a rounded off-centre core whose irregular edge is traced along dark growth bands, with four fine branched radial checks through it. Banyan has three darker curving fusion seams crossing changes of grain. Bare wood occupies broken notches in the bark band. Broad source illumination is discarded; the accepted wood and bark swatches remain the colour basis. |
| [stump_cuts_height.png](stump_cuts_height.png) | Six wedge-shaped plane regions cover each cut and meet at its torn hinge. Narrow broken transitions replace the old broad blended facet supports and dish. Growth-band relief shares the colour field and stays below a quarter millimetre. Oak checks recess up to 1.7 mm; banyan seams up to 2.2 mm. Notches have lowered broken wood and adjacent bark flanges lift up to 5.5 mm. Protected hinge cores retain their original delivered heights. **16-bit grayscale; unchanged full encoding range of 48 mm, white high.** |
| [stump_cuts_normal.png](stump_cuts_normal.png) | Recomputed exclusively from the delivered, quantized height, using each quarter's original physical pixel pitch. **OpenGL convention remains +X right, +Y image-up, +Z outward.** Facet steps, ring bands, checks, seams and lifted bark therefore agree with the height. |
| [stump_cuts_orm.png](stump_cuts_orm.png) | Recomputed cavity AO from the revised height. Rougher torn-out facets and smoother pale cuts now have different roughness; the saved fresh-wood channel is constrained to **192–229**, or **0.75294–0.89804**. Bark, concrete and the accepted hinge retain their material treatment. Metalness remains exactly zero. |

The measurements below are from the saved maps. Facet steps are estimated by extrapolating samples on either side of a boundary, excluding the hinge and concrete; the columns show median / 95th percentile. Ring entries are authored amplitude limits, not a remapping of the full height range.

| Species | Facets | Measured facet step, median / p95 | Ring relief limit | Ring value modulation limit | Bark breaks | Actual disc height extrema |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Fig | 6 | 5.04 / 6.42 mm | ±0.12 mm | ±3.1% | 6 | 18.076–44.834 mm |
| Oak | 6 | 5.05 / 7.26 mm | ±0.22 mm | ±4.9% | 6 | 17.652–43.569 mm |
| Mangrove | 6 | 4.37 / 7.22 mm | ±0.10 mm | ±4.0% | 5 | 17.030–45.474 mm |
| Banyan | 6 | 5.09 / 6.65 mm | ±0.13 mm | ±3.3% | 5 | 16.853–41.744 mm |

The **48 mm encoding and 24 mm datum are unchanged**: `height_code / 65535 × 48` mm, or `(height_normalized − 0.5) × 0.048` metres for centred displacement. The intact bark band remains 20–40 mm wide. Its local width is deliberately smaller where a blow removed bark; these breaks stay inside the original disc footprint. The former requirement that every radial sample contain 20 mm of bark is now checked on the intact band, with separate checks for exposed notches and lifted flanges.

**Validation: 131 checks passed, none failed**, including a byte-identical rebuild of all four PNGs. The ordinary check command runs 130 checks. [metrics.json](checks/metrics.json) records formats, scale, layout, facet areas and steps, ring/colour registration, heartwood shape, notch coverage, roughness and normal agreement; [rebuild.json](checks/rebuild.json) records before/after hashes. Independent height-to-normal agreement is **0.17086° mean, 0.27487° p95, 0.38690° maximum**, with **100% OpenGL green-sign agreement**. Compared with the frozen round-one outputs, protected hinge interiors have **zero base-colour and height-code differences** in every species, and bark base colour outside a 414 px local radius is byte-identical. All disc centres and diameters still pass the original measurements. Visual review covered both lights, neutral relief, native detail and the supplied concept; the new [structure sheet](checks/round2_structure.jpg) also separates the six facets from submillimetre ring relief.

Four new original-source edits were made with the **built-in image generation tool**, then retained unmodified at **1254 × 1254** as [round2_fig.png](source/round2_fig.png), [round2_oak.png](source/round2_oak.png), [round2_mangrove.png](source/round2_mangrove.png), and [round2_banyan.png](source/round2_banyan.png). The original four sources are also unchanged. Exact prompts are in [round2_prompts.json](source/round2_prompts.json), hashes in [manifest.json](source/manifest.json), and source decisions in [REVIEW.md](source/REVIEW.md). No external reference search, downloaded imagery, or image-generation API fallback was used.

[build_material.py](build_material.py) now calls [round2_geometry.py](round2_geometry.py), with editable native-source facet spokes, checks and material controls in [round2_structure.json](source/round2_structure.json). The original structure remains the source for the accepted hinges, concrete and seam paths. Interior ring registration is isotropic, keeping bark-boundary sampling ripples out of the fine growth arcs. `derivation.npz` retains shared masks and intermediate fields. [check_material.py](check_material.py) rebuilds the review sheets and measures the delivered files independently. Round-one outputs and measurements are retained in `checks/round1/` as comparison inputs.

Rebuild and verify from the frozen local sources, with the existing pinned dependencies:

```sh
python3 build_material.py
python3 check_material.py --rebuild
```

During review I replaced a blotchy first-pass oak heartwood mask, removed registration-induced ring waviness, broadened the mangrove bark notches, and constrained roughness after 8-bit quantization. The remaining limits are the same material/mesh boundary as before: the height range cannot make the concept's tall free splinters or undercuts, and these maps have not been tested on the target meshes under final engine lighting and compression. The concept comparison is a review image; its pixels are not part of the material layers.

---

**Round-one record — superseded by the round-two changes above.**

The four stump-cut maps are complete and aligned at **2048 × 2048**. I would ship this set as an authored game material. The saved outputs pass **85 checks**, including a **byte-identical rebuild** of all four PNGs. Start with [the layer sheet](checks/layers.jpg), [the opposing-light views](checks/relighting.jpg), and [the layout overlay](checks/base_over_layout.png).

| File | How it was made | Checks and observations |
| --- | --- | --- |
| [stump_cuts_base.png](stump_cuts_base.png) | Four independent generated paintings were registered into their 1024-pixel quarters. Broad source illumination was discarded; reflectance was reconstructed from DESIGN.md's cut-wood and bark swatches, with compressed grain and ring pigment. Separate masks preserve fig concrete, oak heartwood and banyan fusion seams. Native bark lips and overlapping source-corner patches supply the exterior continuation. Fine coherent fibres and pores were added at master resolution. **8-bit RGB, embedded sRGB profile.** | Inspected the atlas, native detail crops, concrete alignment and layout overlay. Fig is pale and fibrous with a grey mineral inclusion; oak has brown heartwood and interrupted rings; mangrove is warmer and redder; banyan has several growth centres and winding fusion seams. No directional light, cast shadow or specular highlight was deliberately retained. Cavity shading is supplied by AO and runtime lighting. |
| [stump_cuts_height.png](stump_cuts_height.png) | Authored sloping facet supports, torn hinge ridges, raised fibre tips, recessed fusion seams, chipped bark lips and concrete relief. Native source detail supplies shallow fibre relief; deterministic new fibres add subpixel-scale detail at the final resolution. Every feature uses the same registration as colour. **16-bit grayscale, linear, white high.** | Checked the PNG header, range, lack of clipping, feature registration and neutral-grey relighting. The early straight facet traces were softened so the natural broken fibre edges dominate. Fine mangrove relief was reduced for its smaller physical scale. The full encoded range is **48 mm**; actual disc extrema are in the table below. |
| [stump_cuts_normal.png](stump_cuts_normal.png) | Computed exclusively from the **delivered, quantized height PNG**, with each quarter's physical pixel pitch. Central differences inside each quarter; one-sided derivatives at its outer boundaries. **8-bit RGB, linear data, OpenGL convention.** | Independently reconstructed normals from the saved height using an explicit derivative stencil. Angular disagreement is **0.17089° mean, 0.27543° p95, 0.38690° maximum**, consistent with 8-bit normal quantization. Green-sign agreement is **100%** on tested nontrivial slopes in all four quarters. Positive Z and vector lengths pass. Opposing lights reverse the expected relief response. |
| [stump_cuts_orm.png](stump_cuts_orm.png) | **R:** three-scale height-cavity AO using radii specified in millimetres. **G:** material roughness, with slightly rougher torn fibres, bark and concrete. **B:** zero everywhere. **8-bit RGB, linear data, no colour profile.** | Inspected packed and individual channels. Metalness has **zero nonzero pixels**. Fresh-wood roughness is **0.7569–0.8902** across the saved atlas, within the requested range. AO follows local cavities; the dark oak heartwood does not receive an arbitrary dark AO fill. |

The height encoding is `height_code / 65535 × 48` millimetres. A 50% sample is the **24 mm reference level**, so a centred displacement implementation can use `(height_normalized − 0.5) × 0.048` metres. The normal calculation uses the entire 48 mm scale; do not renormalize the occupied height range independently for each species.

| Quarter | Outer disc diameter | Square UV coverage | Millimetres per pixel | Mean bark width | Actual disc height extrema |
| --- | ---: | ---: | ---: | ---: | ---: |
| Top left — fig | 1.50 m | 1.875 × 1.875 m | 1.831055 | 29.998 mm | 15.005–44.834 mm |
| Top right — live oak | 2.00 m | 2.500 × 2.500 m | 2.441406 | 34.992 mm | 14.012–43.569 mm |
| Bottom left — mangrove | 0.50 m | 0.625 × 0.625 m | 0.610352 | 25.006 mm | 14.823–45.474 mm |
| Bottom right — banyan | 2.20 m | 2.750 × 2.750 m | 2.685547 | 30.005 mm | 14.532–41.744 mm |

Each disc has a measured equivalent diameter of **819.1988 px**, or **79.9999%** of its quarter. Its centre is at local pixel-centre coordinates **(511.5, 511.5)**. The measured bark widths vary approximately **20.14–40.04 mm** across the set; the tiny excess over 40 mm is subpixel mask/radial-sampling tolerance. Bark continues throughout the unused square outside each disc. The turquoise circle in the overlay marks the intended outer mesh edge, including the bark band.

The normal convention is **+X image-right, +Y image-up, +Z outward**. Before encoding, the vector is proportional to `(-dH/dx, +dH/dy_down, 1)`. Derivatives never cross into another atlas quarter. Import **only base colour as sRGB**; height, normal and ORM are linear data. Match the stated physical disc diameters when applying the maps. This is a four-island atlas, not one repeating surface.

All four original source pictures are retained unmodified at **1254 × 1254** in [source/](source/). This is a composition of independent plates with additional final-resolution detail, not a single small atlas enlarged to 2K. Generation used the **built-in image generation tool**, with the exact prompt set retained in [source/generation_prompts.json](source/generation_prompts.json). The source review and corrections are documented in [source/REVIEW.md](source/REVIEW.md). No image-generation API fallback, reference-image search, downloaded photograph or existing-game picture was used. The repository's supplied concept paintings and material examples were inspected; their pixels were not copied into these textures.

[build_material.py](build_material.py) builds every delivered layer. [check_material.py](check_material.py) independently verifies the saved images and regenerates the review artifacts. [source/structure.json](source/structure.json) holds editable native-source traces; [source/manifest.json](source/manifest.json) records the original dimensions and hashes. [material.json](material.json) records the scale and layout. `derivation.npz` holds shared masks and the added-fibre field for inspection. `source/sRGB.icc` is frozen to prevent an ICC creation timestamp from changing rebuild hashes. Tested dependencies are pinned in [requirements.txt](requirements.txt).

Run from this folder:

```sh
python3 build_material.py
python3 check_material.py --rebuild
```

The ordinary check command, without `--rebuild`, performs 84 checks; the additional reproducibility check brings the completed run to 85. No network access or generation service is needed to rebuild from the frozen sources.

The inspection artifacts in [checks/](checks/) are:

- **layers.jpg** — four-layer contact sheet; height is reduced to 8-bit only for display.
- **base_over_layout.png** — base colour over the supplied layout, with quarter boundaries, disc edges and centres marked.
- **`<species>_lit_upper_left.png` / `<species>_lit_lower_right.png`** — all four discs at native quarter resolution under opposing lights using the saved normals, AO and roughness.
- **relighting.jpg** — all eight lit views together.
- **`<species>_clay_*.png` / relief_clay.jpg** — the same lights with neutral reflectance, isolating relief from species pigment.
- **native_details.jpg**, **concrete_alignment.jpg**, **orm_channels.jpg**, **base_preview.jpg** — close registration checks, concrete, unpacked channels and overview.
- **metrics.json** — PNG formats, profiles, hashes, layout/rim measurements, scalar ranges, per-species normal agreement, green sign and all check outcomes.
- **rebuild.json** — before/after SHA-256 hashes proving all four maps rebuild byte-for-byte.

Visual review found and corrected a fragmented concrete mask, excessive red pigment coverage in the mangrove, overly straight facet transitions and excessive fine mangrove relief. The final opposing-light and neutral-grey views preserve broad bites, broken rings and offset torn hinges. Oak heartwood remains a pigment distinction rather than a broad height depression; the banyan's fused seams remain visible across its separate growth centres.

Remaining limitations: this is authored material, not measured photogrammetry. Fine pigment/relief separation and the cavity AO are estimates, and roughness is artist-chosen. The height field cannot represent fibre undercuts or the concept's taller 5–10 cm free splinters; those silhouettes need mesh geometry. The finite-height concrete patch also cannot substitute for a protruding column mesh. I have not tested these maps on the target stump meshes, with their UV distortion, texture compression or final engine lighting. Within the delivered maps and review renders, I found no remaining format, alignment or visual defect that calls for another material revision.
