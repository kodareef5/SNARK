The sea grape atlas is complete: ten single leaves with petioles, three hanging fruit racemes, one seven-leaf twig spray, and the full-height bark column. All four texture layers are 2048 × 2048. There is no regions layer.

The design follows the repository's `seagrape.png`, `seagrape_individuals.png`, `seagrape_parts.png`, `seagrape_cut.png`, and coastal `NOTES.md`. The wood layer contact sheet named in the common brief was also inspected. No outside reference images or existing-game imagery were used.

All botanical originals were generated individually with the **built-in imagegen tool**. The exact prompt set is in [source/prompts.json](source/prompts.json). Eighteen unchanged originals are retained: fifteen selected assets and three earlier fruit versions. The earlier fruit versions were replaced because their berries were too small relative to a 25 cm raceme.

| File | Contents and construction |
| --- | --- |
| [seagrape_base.png](seagrape_base.png) | 8-bit sRGB RGBA. Generated colour, cleaned native-alpha silhouettes, opaque interiors and narrow antialiasing, scaled by physical dimensions. Broad residual fruit shading is removed per berry while retaining pigment hue and fine speckling. Edge RGB is extended 36 pixels into transparency; more distant space uses the corresponding element's mean colour. |
| [seagrape_height.png](seagrape_height.png) | 16-bit greyscale. Shallow domes/cups and rounded petioles, relief from the visible veins, fitted fruit hemispheres, seven annotated twig blades with overlap heights, and fine bark relief. Transparent pixels are exactly zero. |
| [seagrape_normal.png](seagrape_normal.png) | Linear RGB, OpenGL tangent space. Calculated from the reopened delivered height PNG, after 16-bit quantization. |
| [seagrape_orm.png](seagrape_orm.png) | Linear RGB: vein-hollow, attachment and fruit-contact AO, material roughness, zero metalness. Round 2 targets leaf faces at 0.62–0.74 roughness with smoother midribs, fruit at 0.55–0.65, and preserves stalks and bark. Measurements are recorded below. |
| [layout.json](layout.json) | All 15 non-overlapping rectangles, physical lengths, centered stalk anchors and measured tips. The fruit anchors are at the top, with tips below. |
| [build_atlas.py](build_atlas.py) | Deterministic offline build of every layer, layout, prepared element cache and metadata. |
| [check_atlas.py](check_atlas.py) | Independent numerical checks and all review-image generation; returns a failing exit status on an unmet check. |
| [source/](source/) | Full-size originals, exact prompts, packing/material recipe, geometry annotations, dependency versions, prepared cut-outs and provenance. See [source/README.md](source/README.md). |
| [checks/](checks/) | Layer contact sheet, native-resolution and 256-pixel background checks, annotated layout, each element under two opposing lights, measurements and reproducibility hashes. |

Scale is **1300 pixels per metre** for all cut-outs. The single leaves are 15–25 cm wide, with the mature variants concentrated at 22.5–25 cm. `leaf4` is the young yellow-green leaf; `leaf5` has strong red veins; `leaf6` and `leaf7` are orange and red; `leaf8` is yellowing; `leaf9` has four through-holes; `leaf10` has the torn right margin. `leaf1`–`leaf3` provide the other mature green variations. All include their complete short stalk.

The three racemes are approximately 24.9 cm from anchor to tip and contain 19, 18 and 18 berries. Fitted berry diameters span **1.508–1.781 cm**. `twig1` measures 42.13 cm from its foot to its highest leaf tip and has seven young leaves. The bark occupies `[1920, 0, 2048, 2048]`, with `metres: 0.7`. It is cropped from the generated bark at an isotropic scale and blended at the vertical repeat boundary. Its physical normal-map density is therefore **2925.714 px/m**, distinct from the cut-outs.

The full height encoding range is **20 mm**: 0 is 0 mm and 65535 is 20 mm. The delivered occupied range reaches approximately **10.51 mm**, principally at fruit centres. Height is authored relief, not a measured photogrammetric reconstruction. Normals use `normalize(-dH/dx, +dH/dy_image, 1)`, accounting for physical texel size. Bark differentiation wraps vertically; the cut-out and bark UV islands are differentiated separately.

Validation was run with `python3 check_atlas.py` and passed with no failures. The evidence is in [checks/measurements.json](checks/measurements.json):

- Every cut-out has at least **34 transparent pixels** on every side. No rectangle overlaps another or enters the bark column.
- All cut-outs form one connected component at the checked alpha threshold, including the thin stalks. Healthy leaves have no holes; the insect-damaged leaf has exactly four.
- Partial-alpha pixels occupy **0.4141%** of the atlas; alpha values 64–191 occupy **0.1860%**. No partial alpha remains in the eroded interior of a surface.
- An independent calculation from the delivered height matches the delivered normal map **exactly in all encoded channels**. Angular error from 8-bit normal quantization averages **0.1722°**, with a maximum of **0.3832°**.
- Base, height, normal and ORM have **zero top-to-bottom bark seam difference**.
- All **500,260 tested transparent pixels within 32 pixels of a silhouette** match the nearest edge colour exactly.
- The 256-pixel straight-RGB/alpha mip check has a mean visible edge error of **1.38/255**, and a 95th-percentile error of **4.79/255**, against alpha-weighted colour averaging.

The [layer contact sheet](checks/layers.jpg), [layout overlay](checks/layout.png), [element contact sheet](checks/elements.jpg), all three 256-pixel background previews, the full-size white composite, and [two-direction relighting contact sheet](checks/relit_contact.jpg) were visually inspected. The round outlines, small stalks, leaf holes and torn margin remain clean. No dark or grey fringe is visible in the small previews. Young, mature and senescent leaf colours remain distinct; normal lighting reverses the berry shading correctly.

The main remaining compromise is atlas occupancy: visible surface coverage is **22.61%**, including the bark. Fourteen cut-outs of these specified real dimensions occupy only a limited part of a 2048-pixel sheet at 1300 px/m. The leaves and fruit are already near the upper end of their size ranges, so the sheet retains substantial transparent space. The generated base colours and synthesized relief are visually matched material assets rather than measured scans. Thin fruit pedicels approach subpixel width at 256 pixels; eventual in-game alpha-test thresholds and card bending still need review in the assembled shrub.

Rebuild from this folder with:

```sh
python3 build_atlas.py
python3 check_atlas.py
```

Python 3.9, Pillow 11.3.0, NumPy 2.0.2 and SciPy 1.13.1 were used. A second offline build reproduced **all four PNGs and layout.json byte for byte**; [checks/rebuild.json](checks/rebuild.json) now records the latest round-2 verification. The first-round verification build took **15.28 seconds**. The initial authoring, generation, assembly and review session took approximately **20 minutes** on 14 November 2026; exact UTC session times are in `source/session.json`.

**Round 2 — packed material correction**

Only the delivered ORM texture changed. Leaf faces, including all seven twig blades, now have a leathery satin finish within the requested 0.62–0.74 roughness range, with a small reduction along the strong midrib/vein ridges. Fruit targets 0.55–0.65. The reopened 8-bit texture measures **0.6235–0.7412** on leaf faces and **0.5686–0.6314** on berry faces; the leaf upper endpoint is the nearest 8-bit representation of 0.74.

Occlusion now follows connected visible veins and their adjoining hollows, darkens the blade attachment to approximately **0.70**, and returns to **1.00** on open blade areas. Smaller twig leaves use narrower vein-side falloff. Fruit occlusion is stronger on inward-facing attachment rims and between neighbouring grapes. These changes affect only packed channels; the height-derived relief is untouched.

The following means use decoded linear channel values over **drawn pixels (`base alpha > 0`)**, excluding transparent padding. The whole-atlas selection includes the unchanged bark. Face-only rows exclude stalks.

| Selection | Mean occlusion | Mean roughness |
| --- | ---: | ---: |
| All 956,725 drawn pixels | **0.8512** | **0.7439** |
| Cut-outs, excluding bark | 0.7988 | 0.6948 |
| All leaf faces, including twig leaves | 0.7936 | 0.6959 |
| Single-leaf faces | 0.7936 | 0.6981 |
| Twig leaf faces | 0.7934 | 0.6678 |
| Berry faces | 0.8898 | 0.5996 |
| Bark, unchanged | 0.9902 | 0.8738 |

Whole-atlas occlusion fell from **0.9942 to 0.8512**; roughness rose from **0.6125 to 0.7439**. Weighting by alpha instead gives **0.8509 occlusion** and **0.7443 roughness**. Per-element statistics are generated by `check_atlas.py` in [checks/measurements.json](checks/measurements.json); before/after face statistics and preservation hashes are in [checks/round2.json](checks/round2.json).

Every layer was rebuilt from `source/` using `python3 build_atlas.py`, and `python3 check_atlas.py` passed with no failures. SHA-256 comparisons confirm that base colour (including alpha), height, normal, layout, sprite definitions, all original images, geometry and prepared cut-outs remain **byte-for-byte identical** to round 1. All **276,430 stalk/wood pixels**, including bark, retain every original ORM channel; metalness and transparent ORM padding are also unchanged. A further offline rebuild reproduced all four final PNGs and layout exactly in **8.876 seconds**.

The [separate packed-channel review](checks/packed_channels.png) and [relighting contact sheet](checks/relit_contact.jpg) were inspected. The checker now applies AO to its ambient sky term only, leaving direct illumination unattenuated, matching the supplied game-lighting rule. These previews verify the channel placement and diffuse response; they do not simulate the game's sky reflections.
