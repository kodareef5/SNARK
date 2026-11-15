The velvet fuzz study delivers `fuzz`, `fuzz_face`, and `mantle_edge`: fifteen aligned 2048 × 2048 maps, plus generated sources, an aligned patch library, deterministic build scripts, measurements, and visual checks. All authored files are inside this study folder.

The source was made with the built-in image generation tool. The final prompt and untouched result are [source/prompt_fuzz_concept.txt](source/prompt_fuzz_concept.txt) and [source/fuzz_concept.png](source/fuzz_concept.png). It uses our `ref/concept/head_side.png` as its only reference image. I also inspected `head_front.png` and `saddle_detail.png`. The tool returned 1254-square originals, despite the requested larger resolution. The final maps synthesize a larger field from native detail; they are not a single enlarged 1254 image. The two earlier sources and their exact prompts are retained, with hashes and provenance in [source/manifest.json](source/manifest.json).

The first, finer source became too uniform at the animal's density. The final source retains coherent little wavy locks. The build reduces it to 80%, removes broad lighting, and quilts irregular source patches with minimum-error overlap cuts. It closes both wraps before deriving the maps. The seed, source positions, horizontal flips, and sample edge curves are recorded in `synthesis.json`. There is no grid of repeated tuft stamps.

| Set | Tile span / density | Target filament length | Encoded black-to-white height | Actual delivered relief range | Region mean, linear |
|---|---|---|---|---|---|
| `fuzz` | 0.5 m / 4096 px per m | 4–8 mm | 0.80 mm | 0.4534 mm | 5: 0.4999998 |
| `fuzz_face` | 0.25 m / 8192 px per m | 2–4 mm | 0.40 mm | 0.2267 mm | 5: 0.4999998 |
| `mantle_edge` | 0.5 m / 4096 px per m | 4–8 mm | 0.80 mm | 0.4618 mm | 0: 0.5000015; 5: 0.5000021 |

All sets tile in both axes, are opaque, and lie from top toward bottom. The body and face use identical pixel morphology at half the physical span and half the relief. This deliberately keeps their character identical while halving physical strand length. The specified egg radii are in `study.json`; its `form` and `radii` are flat properties, as required by the actual `look.ts` reader.

The length figures are the intended physical calibration of the generated fine filaments, not a measurement of every generated strand. Overlapping filaments create longer visible locks and flows. Height describes the shallow exposed pile surface, not the full length of a filament lying along it.

| Pictures, for each set | How made |
|---|---|
| `*_base.png` | Edited from the generated photographic source by script: neutralized, broad illumination removed, synthesized into a periodic field, and each region normalized to 0.50 linear. The fine value drawing remains in this layer. The mantle adds faint aligned pigment drawing on its edge filaments. RGB, 8-bit sRGB. |
| `*_height.png` | Computed as restrained, smoothed filament relief plus a gentle pile bed. The mantle's additional edge fibres enter this same height. Greyscale, 16-bit PNG, with unused range left as headroom. |
| `*_normal.png` | Computed from the delivered, quantized height with wrapped central differences and the physical span and height range. OpenGL convention, +Y toward the image top. RGB, 8-bit. |
| `*_packed.png` | Computed from height: restrained local concavity occlusion, slightly varying dry roughness, zero metalness. Linear RGB. Occlusion 0.949–1; roughness 0.882–0.933. |
| `*_regions.png` | Computed categorical IDs. Body and face are solid yellow. Mantle is red above and yellow below, with separately labelled curved filaments through the transition. Exactly pure region colours, no antialiasing. |

The main mantle transition is about **17.6 mm** wide by the 5–95% row-coverage measure, including its gentle wavering. Its thin curved filaments follow the source's local orientation and share pigment, height and region assignment. A smaller second transition lies approximately 26 pixels inside the top wrap, so the top and bottom rows meet without an artificial colour jump. Nine pixel transitions occur across the left/right join, within the natural fringe. Neither dye is baked into the base.

`elements/` contains four 256-square patches of different locks, each with all five aligned layers and its source box. These cover 62.5 mm at the body scale. They are rectangular painting sources, not standalone seamless tiles or individual hair cutouts. `elements/elements.json` records their scale and use. The entire generated source and full tile also remain reusable. `build.py --scale NUMBER --direction-deg NUMBER` controls source feature size and lie before synthesis; the delivered default is `1` and `0`. Re-run the checks after changing either.

Rebuild and check from the pteranodon folder:

```sh
python3 tex/studies/fuzz/build.py
python3 tex/studies/fuzz/check.py
bun tex/studies/look.ts tex/studies/fuzz
bun tex/studies/fuzz/check_game.ts
```

The last script uses the game's actual image readers, seam measurement and height/normal correlation. It also creates an extra copy of the shared look renderer under `checks/`, changing only dye rows and the far distance to 20 m. It does not edit the shared renderer.

All numerical checks passed. Details are in [measurements.json](measurements.json) and [engine_measurements.json](engine_measurements.json).

| Check | Final result |
|---|---|
| Map size and height format | All main maps 2048 square; all height PNGs genuinely 16-bit |
| Neutral base | R = G = B in every pixel |
| Quarter mean spread | At most 0.097%, relative to mean; limit 2% |
| Base versus light caught by normals | Maximum absolute correlation 0.0278 across 32 sampled directions |
| Game height/normal agreement | At least 0.9990 across and down |
| Normal unit length | Mean 1.000414; maximum deviation 0.00554 from 8-bit quantization |
| Game wrap ratios, all continuous layers | 0.922–1.043; below 1.3 |
| Invalid region pixels / metalness | Zero / zero |

I inspected the game's three final contact sheets in `checks/look/`: two views/lights at 0.5 m, then 1.5 m and 5 m, in design, loud, dark and pale dyes. I also inspected the extra hot-pink and near-black sheets in `checks/look_extra/`, including the 20 m boundary. At 0.5 m the material has visible flowing fine pile; at 1.5 m it quiets down; at 5 m it is an even tone. Hot pink preserves the strand pattern. The mantle has a fine fibrous fringe close up and a clean colour boundary at 20 m.

The Python checks include full-resolution unlit and two-direction relit pictures in ivory/charcoal, pink/lime, lime/blue, near-black and near-white. They also include actual-density and one-tenth-density reductions, full-resolution half offsets, 3 × 3 repeats, [concept_at_scale.png](checks/concept_at_scale.png), and [original_base_relit.png](checks/original_base_relit.png). The latter compares source, delivered base and relit set at the same scale. The source's strand drawing survives in the base. I did not find a continuous wrap line or an obvious repeated tuft motif in the offset/repeat views.

Where it still falls short: near-black in the game's shadowed view suppresses most of the finest drawing; it is less tactile there than the ivory or pink version. The concept's neck has stronger large lock grouping and form lighting than this flat study, so the match is closest in strand character rather than an exact duplication of its pictured neck. A few generated flows read as longer connected locks; individual filament length has not been exhaustively segmented and measured. These maps give shallow surface relief, not actual silhouette fuzz. The shared egg preview pinches its UVs at the pole and shows a narrow join in the second mantle view; the flat maps pass wrap checks, but the final animal still needs its own direction field and UV review.

Elapsed work: approximately 16 minutes, including three image generations, source/edge revisions, map building, numerical checks, and game-renderer review. The final map build itself takes roughly 7 seconds on this machine; previews take longer. No external reference images were searched or downloaded, and Blender was not used.
