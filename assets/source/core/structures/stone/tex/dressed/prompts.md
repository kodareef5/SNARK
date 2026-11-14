# Generation prompts

One built-in imagegen call. No reference image: the supplied wood contact sheet is a quality benchmark, not a visual input. Original output is retained unchanged in `source/limestone_generated.png`.

## Source 1 — pale dressed limestone substrate

```text
Use case: photorealistic-natural
Asset type: source material scan for an unlit PBR game texture; square image, full bleed.
Primary request: a perfectly front-on orthographic texture of a continuous expanse of fine-grained pale warm-grey, very slightly creamy limestone that a medieval mason dressed true. The entire image is stone surface. It has NO blocks, NO joints, NO mortar, NO edges, NO border, NO bevels, NO cracks. Treat this as about 1 metre square of continuous limestone. Photographic mineral detail, soft dusty pale-grey calcite grain, understated irregular bedding threads, a few tiny broken shell specks, sparse millimetre-scale pores. Fine shallow parallel hand-chisel striations may change direction in a few softly merging irregular areas, but must be extremely restrained in the colour. This is the clean good stone of a stronghold, slightly weathered, not ruined or dirty.
Lighting: flat cross-polarized diffuse albedo scan. No directional illumination, no highlight, no shadow, no vignette, no global gradient. Uniform average brightness throughout. Relief should not be lit or shaded.
Colour: low contrast pale warm grey, approximately sRGB (196,195,190), only delicate natural tonal variation. Avoid yellow sandstone, tan concrete, marble veins and glitter.
Composition: seamless in both directions, no prominent central feature and no recognizable repeated motifs. Fine detail everywhere; no blank polished areas, no isolated objects, no writing. Request 2048 by 2048.
```

The final surface will be built at 2048 from this source's locally normalized mineral detail plus a deterministic, periodic height field of native-resolution hand tooling. All derived maps use the same fields. Python processing is explicitly part of the requested material-authoring workflow.

## Revision 2 — source reuse and physical tooling

No further image generation was requested or used. The existing source is reused with much less frequency removal and roughly its original mineral contrast. The user's revision was implemented in `build_material.py`: preserve all 48 patch positions, directions and styles; target 8–12 sRGB levels of variation at the original mean; restore visible source grain and add drift, bedding, shell/inclusion detail, faint iron stains and cavity dirt; replace per-lane dashes with overlapping 40–80 mm multi-groove chisel passes, irregular punches and 2–3 mm pits. Groove pitch is 3.05–4.0 mm, within the requested range and above this texture's approximately 2.93 mm two-pixel sampling limit. This is a script revision, not an additional image-tool prompt.

## Revision 3 — concept-art cream limestone

No new image-tool call or prompt. Visually inspected `../../ref/concept/pieces_walls.png` and `../../ref/concept/inside.png`. The colour-only script revision targets sRGB (206, 198, 180): cream calcite, buff drift tied to the existing geological fields and source chroma, and ochre in mineral inclusions and iron traces. Shell fragments remain paler and groove dirt greyer. Height, normal, ORM, patch layout and all shared physical fields are unchanged. The previous material and its checks are archived in `round2/`.
