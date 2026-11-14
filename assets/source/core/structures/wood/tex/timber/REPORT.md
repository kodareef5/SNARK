# Timber — fourth pass: unlit material palette

Changed only the base colour to the written **T (98, 67, 45)** target. Its measured 8-bit sRGB mean is **(98.000, 67.000, 45.000)**, previously **(100.000, 58.000, 36.000)**. The **2048 × 2048**, **3 × 3 m**, twelve-band trim layout is unchanged. Height, OpenGL normal and packed ORM are **byte-identical to pass three** (and pass two). Every construction field, construction/layout record, generated source and the embedded sRGB profile matches the pre-edit snapshot.

The [contact sheet](checks/contact_sheet.jpg) starts with the pass-three base, pass-four base and the written T / T+ / B swatches. The larger [base-colour before/after](checks/base_before_after.jpg) compares the same unlit texture at the same scale. Lit, native-detail, offset and repeat previews have been regenerated; the [historical relief comparison](checks/before_after.jpg) retains the original geometry review under identical lighting and neutral pigment.

## Fourth-pass colour change

Read the **Material palette** section of [DESIGN.md](../../ref/concept/DESIGN.md). Its values explicitly describe unlit 8-bit sRGB: structural timber **T (98, 67, 45)**, rubbed arrises **T+ (118, 82, 55)** and boards **B (172, 128, 82)**. These supersede pass three's targets taken from warm sunlit paintings. The mean timber swatch's HSV saturation falls from **0.640 to 0.541**, and hue moves from **20.62° to 24.91°**, reducing the red cast.

`build_material.py` adds **(20, 15, 10) × the existing arris envelope** to the finished pigment, then centres the complete base on T. The existing softened **10 mm** edge footprint is used without changing its geometry. Outer arris samples (envelope > 0.8) average **(115.51, 80.16, 53.88)**, leaning toward T+ while retaining each band's colour, weathering and darker wane. Interior pigment receives only a constant channel shift, approximately **(-2.8, +8.4, +8.6)** from pass three. There is no contrast scaling, blur, lighting or AO multiplication.

Band offsets relative to the global mean are retained within **0.076 byte units**; after accounting for the slightly different arris sampling of 170/171-row bands, pigment offsets agree within **0.0021**. The original grain, hewing tones, kerf pigment, split-wood checks and stains remain readable. Every pixel agrees with the intended channel/arris offsets within **0.972 byte units**, inside the one-byte allowance for separately quantized PNGs. Dark checks and natural pigment variation are not clamped to the palette swatches.

Weathered bands **2, 7 and 10** retain their greyer character, with mean colours approximately **(91, 72, 58)**, **(89, 69, 54)** and **(91, 70, 53)**. They remain less saturated than every hewn/sawn band; every band's saturation is lower than pass three. The frame's mean linear luminance is **0.06800**, versus **0.24818** for board B, or **27.4%** of the board value, preserving the strong frame/infill contrast. B is shown as a reference swatch.

Visual review of the before/after, contact sheet and native hewn, sawn and weathered crops confirms the retained colour detail and softened edge wear. Seam, encoding, physical-feature and independent height-to-normal checks pass. Palette checks also verify each band's rubbed edges and all protected data against the frozen pass-three baseline. An actual second build reproduces **all four delivery PNGs byte-for-byte**.

## Retained second-pass surface construction

Band numbers are zero-based, top to bottom.

| Treatment | Bands | Second-pass construction |
|---|---|---|
| Hewn | 0, 3, 5, 8 | Overlapping broad axe/adze scoops, nominally **90–200 mm along the grain**, spanning the face, with **2.4–4.8 mm peak cuts**. Irregular spacing, blade angles, curvature and overlap produce meeting facets. Native torn fibres, slight grain shear and small pigment changes accompany the cuts. |
| Sawn | 1, 4, 6, 9, 11 | Straight cross-grain kerfs with slightly varying angles, **5.01–14.69 mm spacing**, and authored depths **0.30–0.60 mm**. Actual sampled peak cuts are approximately **0.599 mm**, compared with only 0.025–0.075 mm in pass one. |
| Weathered | 2, 7, 10 | Worn, shallower tool marks, partially eroded kerfs, raised grain, short split fibres and a rougher dry surface. More grey in the pigment, while retaining the underlying dark brown. |

The first procedural revision made the hewing too much like curved scores. It was replaced with broad overlapping spoon-shaped cuts whose slopes change across the face. In the final neutral previews, the scoops remain visible when the light reverses; they are actual height relief. Colour only carries restrained facet/pigment changes and broken fibres, without multiplying lighting or AO into the base.

The three principal drying checks now have irregular mouths, tapered ends, steep textured walls and dark oxidised split-wood pigment:

| Band | Length | Maximum nominal mouth width | Authored principal depth |
|---|---:|---:|---:|
| 0 | 940 mm | 7.6 mm | 5.8 mm |
| 7 | 780 mm | 6.4 mm | 5.3 mm |
| 10 | 1160 mm | 7.2 mm | 6.6 mm |

The band-10 check crosses the horizontal wrap continuously. Small branching splits remain. Native wall texture modulates the depth slightly; the deepest sampled check component is **6.618 mm**. These checks are now visible in the unlit base and the post previews, rather than relying on a thin normal-map line.

There are subtle crushed-grain bruises on bands 3, 6 and 10; four small iron/tannin stains on bands 1, 5, 8 and 11; and darker, wider bark-side arris rounding on bands **2 and 8**. Iron staining is pigment in wood: metalness stays zero. The two **25 mm** empty peg holes remain on bands 3 and 9. Their floors are held at 2.4 mm in the encoded height coordinate so a bore intersecting a deep axe cut cannot clip below the height range.

Fine fibres, pores, kerfs and wall texture are constructed at **2048 resolution**, with **1.46484375 mm per texel**. There is no final blur or enlargement of a low-resolution master. Weathered fibres have more relief and roughness; the small handling-polish patches remain.

## Delivered maps

| File | Format | Final result |
|---|---|---|
| `timber_base.png` | RGB, 8-bit sRGB, frozen embedded sRGB profile | Mean **(98.000, 67.000, 45.000)**: muted structural brown at T, rubbed arrises toward T+, retained band variety and greyer weathered fibres. No lighting or AO pass baked in. |
| `timber_height.png` | Single-channel, 16-bit grayscale, linear, white high | Full **0–65535 = 0–16 mm**. Saved values occupy **2.39994–15.64208 mm**, without clipping. |
| `timber_normal.png` | RGB, 8-bit linear, OpenGL tangent space | **+X right, +Y up the image, +Z outward.** Recomputed from the reopened saved height at the actual 3 m scale. Independent verification finds **zero mismatched channels and zero maximum byte error**. |
| `timber_orm.png` | RGB, 8-bit linear | R: geometry-derived horizon/cavity AO. G: authored roughness. B: zero everywhere. Roughness **0.400–0.961**, median **0.757**. AO median **0.996**, minimum **0.173**. |

The three data maps contain no sRGB, gamma or ICC chunks. All four PNG dimensions, bit depths and colour types were checked directly.

The relief increase is distributed over the faces, not just the peg holes. Away from the arrises, each hewn band's 1st–99th height percentiles span approximately **4.7–4.8 mm**. Median height-derived normal tilt increased as follows under the same measurement:

| Treatment | Pass one | Pass two |
|---|---:|---:|
| Hewn | 2.14° | 4.51° |
| Sawn | 2.33° | 5.51° |
| Weathered | 2.68° | 8.39° |

## Layout, seams and review

All boundaries remain exactly **k × 2048 / 12**. Pixel-centre assignment is still `floor((row + 0.5) × 12 / 2048)`, giving **171, 170, 171** rows repeated four times. No separator rows or drift were added. The existing last-centimetre arris envelope remains, with the additional wane confined within its assigned bands. Top/bottom wrapping is another timber boundary.

All four horizontal wrap differences remain below their corresponding interior column-difference 95th percentiles:

| Map | Wrap mean difference | Interior 95th percentile |
|---|---:|---:|
| Base, byte units | 1.8480 | 2.0514 |
| Height, mm | 0.10662 | 0.11083 |
| Normal, byte units | 3.3968 | 3.7917 |
| ORM, byte units | 0.70394 | 0.80741 |

Opposite border pixels are adjacent periodic samples, not duplicate endpoints. Native wrap strips, half-tile offsets, 3 × 3 repeats and the alignment overlay were regenerated and inspected. The wrapped crack remains continuous and there is no visible vertical stitch through the bands.

The updated previews include two moderate opposite light directions, two **7.9°** raking directions along the grain, and an **11.1°** cross-grain rake for raised fibres, check walls and arrises. Neutral relief PNGs use the same normals with constant pigment and roughness. Previews use linear-light diffuse plus a simple dielectric GGX highlight; these are diagnostic renders, not an engine scene or a full displacement/self-shadow renderer.

Lossless, unscaled feature sheets are [hewn](checks/native_hewn.png), [sawn](checks/native_sawn.png), [weathered](checks/native_weathered.png), [wrapped check](checks/native_wrapped_check.png), and [wane](checks/native_wane.png). Each pairs a **1:1 base-colour crop** with lit and neutral relief views. The [12–25 cm post faces](checks/post_faces.jpg) and [full-length posts](checks/full_length_posts.jpg) were also regenerated. At post scale the saw marks, scoops and long checks now distinguish the timber treatments.

## Rebuild and provenance

The three original **1254 × 1254** generated sources and their prompts remain unchanged in `source/`. No new generated image was needed: the missing geometry and corresponding pigment detail were authored in the script. Native source quilting, source de-lighting and duplicate-knot removal are retained. Source cuts remain at **one source pixel per output pixel**, with no enlargement.

Run from this folder with Python 3, Pillow, NumPy and SciPy:

```sh
python3 build_material.py
python3 check_material.py
python3 verify_rebuild.py
```

`verify_rebuild.py` performs an actual rebuild and requires all four delivery PNGs to be **byte-identical**, as well as requiring height, normal and ORM to match pass three. Verification results and hashes are in [checks/rebuild_verification.json](checks/rebuild_verification.json). [checks/metrics.json](checks/metrics.json) records file, seam, normal and per-band relief measurements, physical-feature checks and the fourth-pass palette/preservation checks under `palette_revision`. `source/construction.json` records T, T+ and every unchanged axe cut and saw kerf; `source/construction_fields.npz` retains separate tool, kerf, check, fibre, arris, wane and stain fields.

A snapshot of pass-one maps, scripts, report and review data is retained under `checks/pass1/` for the matched comparison. The scripts at this folder's root are the current build and check scripts.

The pass-two maps, scripts, report, construction metadata, metrics and review sheets remain under `checks/pass2/`. The pre-edit **pass-three** equivalents are now frozen under `checks/pass3/`; its [baseline manifest](checks/pass3/baseline.json) records original file hashes and per-array construction hashes for the current comparison and preservation checks. The build still uses the original frozen generated sources.

## Remaining limits

The grain source is still generated material rather than a measured scan, and pigment/relief separation remains an inference. The hewing is procedural and may reveal some regularity over repeated lengths. AO and roughness are authored approximations. Millimetre-wide details and crack tips will depend on engine compression and mipmapping; no in-engine review was available. The height field cannot represent true undercuts or individual hair-like fibres below the texel size.

Enable sRGB only for base colour; import height, normal and ORM as linear data and use repeat addressing. The 16 mm range is the full encoded span, not ±16 mm. Normal strength is already physically scaled.

Second-pass time: approximately **15 minutes** on 14 November 2026, including native inspection, procedural revisions, visual review, checks and rebuild verification. All work stayed in this folder. No git commands were run.

Third pass: **14 November 2026**. All writes stayed in this folder; concept references were read from the supplied directory. No git commands were run.

Fourth pass: **14 November 2026**. All writes stayed in this folder; the supplied concept `DESIGN.md` was read only. No git commands were run.
