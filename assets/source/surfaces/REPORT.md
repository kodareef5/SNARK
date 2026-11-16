# World surfaces — round one

Sixteen world finishes now replace the checker on the lit tiers' terrain and unarted statics. The same source data drives WebGL2 and the software rasterizer. Low poly keeps its existing shader and requests no atlas textures.

**Acceptance is incomplete:** real WebGL image parity and phone frame time remain unverified in this restricted environment. Three existing medium street cameras exceed the draw budget before and after this patch. The full check's final outcome is recorded below; a failed check is not being presented as a pass.

## What was made

Grass, sand, dirt, mud, rock, gravel, asphalt, paving, concrete, brick, clay tile, rust, steel, plaster, timber and dirty glass. These cover the maps' land-cover colours and the ruins' fallback finishes, including painted metal and coloured plaster. Unknown ground colours use dirt; unknown solid colours use concrete. Architectural limestone shares the fine mineral grain used by concrete; it does not use the ground's fractured-bedrock tile.

The accepted source is four AI-generated 1254 × 1254 photographic material studies in [source/](source/), each containing four finishes. Their exact image-tool briefs are in [prompts/](prompts/). The initial sixteen-cell study is retained as `atlas-original.png`; the build uses the four larger studies. Each accepted cell supplies about 620 source pixels before reduction to 480 usable texels in the high atlas and 240 in medium.

[build.ts](../../../tools/surfaces/build.ts) crops, wraps the edges, adds gutters and derives restrained normal relief and packed AO/roughness. Relief is inferred from luminance, not measured geometry. The generated 2048 px base/normal and packed source, encoded variants and caches stay under ignored `var/` and `.cache/`. No encoded assets are committed. The original source images, generation briefs, processing code and review captures are kept.

The review led to larger source cells, smaller gravel and asphalt aggregate, physical brick/board scales, reduced concrete relief, and a fix for atlas seams under trilinear filtering. I inspected the feather and wood studies and the wood, stone and thatch structure textures. The requested pteranodon `tex/studies/` directory is absent in this checkout. This fallback atlas trades close-up resolution for a small shared download; it should not be mistaken for sixteen individual hero materials.

## Tuning desk

Edit [content/surfaces.ts](../../../content/surfaces.ts). A tuning edit needs a client rebuild or a new standalone capture; it does not require rebuilding a city or re-encoding the textures.

| Data | What it controls |
| --- | --- |
| `SURFACE_FINISHES` | Each finish family: metres per tile, bump, roughness, metalness, retained palette colour and weathering. All concrete palette aliases follow the concrete entry. |
| `SURFACE_GROUPS` | Living ground, dry ground, wet ground, mineral, masonry, metal, paint, timber and glass. Shared tint, scale, bump and weather multipliers; additive wetness and growth. |
| `SURFACE_CITIES` | Miami, Tampa, San Francisco, Los Angeles, Las Vegas and default. The same dials applied across the city's families. Coastal cities are wetter and greener; Vegas is warmer and drier. |
| `GROUND_SURFACES` / `FALLBACK_SURFACES` | Separate palette aliases for ground and solids. For example, 100 means gravel on the ground and concrete on a wall; 89 means paving on the ground and steel on a static. |

Wetness darkens the diffuse colour and lowers roughness. Weather adds broad dirt/staining. Growth adds irregular green staining; it does not spawn vegetation. Tint multiplies linear reflectance. Larger `metres` or `scale` means larger visible features. Family and city bump controls multiply. Brick, clay, paving and timber keep their construction direction.

Examples:

```sh
# Inspect one family after changing its dials, using the cached art.
bun tools/surfaces/views.ts medium miami concrete
# All sixteen finishes, and the 512 m field / 150 m motion checks.
bun tools/surfaces/views.ts medium default
# A city from the exact saved cameras; build cities one at a time if absent.
bun tools/mapworld/build.ts miami
bun tools/mapworld/views.ts var/maps/miami.snmap assets/source/surfaces/cameras/miami.json var/surfaces/tuning medium
# Encode only these three maps and reproduce the byte measurements.
bun tools/surfaces/cost.ts
```

D253 stores tint, not land-cover identity. Several surfaces share colours, so these aliases are an approximation. Vegas overrides its buff open-land colours to gravel. A future independent land-cover channel would allow exact classification and soft material boundaries; the existing two-metre boundaries remain visible in some views.

## Engine changes

- `world-surfaces.ts` contains matching CPU/GLSL projection, hash, sampling and weather operations. Natural surfaces blend three translated, quarter-turned samples with smooth triangular weights. Directional materials keep aligned joints. Continuous 37 m variation and smaller stain fields suppress broad repetition.
- UVs come from absolute metre coordinates on the dominant face axis. Camera movement is added back before sampling. Texture derivatives are taken before wrapping/rotation. Explicit mip filtering, fading normal strength and cell-average colour at large footprints avoid distant texture sparkle.
- The 16 px atlas mip gives every finish its own constant 4 × 4 compression block. Reading the ordinary 4 px atlas mip would compress sixteen unrelated finishes together. Trilinear guards cover both mips being sampled.
- Lit vertex programs carry a semantic surface index; terrain and solids use different lookup tables. The shell binds three shared texture maps and city uniforms. The software rasterizer defers world-surface shading until visibility is resolved and computes the same projected footprint.
- `Scene` requests the atlas through normal material residency and tier caps. A never-drawn metadata mesh sorts after existing mesh IDs. Pack/texture discovery includes the deterministic atlas source. No new draw, triangle, per-static material, authored UV or map-format change is required.
- Authored material draws continue through SURFACE. Their simplified vegetation/node LODs keep palette shading rather than acquiring a concrete finish. Fully rough plain draws avoid the extra sky reflection lookup.

No pinned hash was changed. Lit screenshots change because the checker has been replaced by albedo, relief, roughness and weather. Shader-contract assertions were updated to require the new lighting call and varying, rather than weakening frame checks.

## Pictures and visual review

All camera positions are in [cameras/](cameras/). City images are native 960 × 540 PNGs; sheets are navigation aids. Each city has two ground views and a camera 150 m above the same district. Tampa uses a 45° vertical field of view in both versions; the others use the harness's 70° default. The [image inventory](evidence/pictures.json) records dimensions and SHA-256 hashes for all 98 retained PNGs.

The before renderer is `tools/snap/raster.ts` from `aff5ab93612c38fac637ff3676c6ca639b1bc54e`, captured with the same current scene, streams and cameras as the after renderer. This holds geometry and settling constant. All fifteen matched medium pairs have identical draw and triangle counts: [comparison data](evidence/matched-cameras.json).

| City | Camera | Before | After |
| --- | --- | --- | --- |
| Miami | best-downtown-street | [PNG](pictures/before/miami/best-downtown-street.png) | [PNG](pictures/after/miami/best-downtown-street.png) |
| Miami | spawn-south-beach | [PNG](pictures/before/miami/spawn-south-beach.png) | [PNG](pictures/after/miami/spawn-south-beach.png) |
| Miami | flyer-150m | [PNG](pictures/before/miami/flyer-150m.png) | [PNG](pictures/after/miami/flyer-150m.png) |
| San Francisco | painted-ladies | [PNG](pictures/before/san-francisco/painted-ladies.png) | [PNG](pictures/after/san-francisco/painted-ladies.png) |
| San Francisco | spawn-presidio-tunnel-tops | [PNG](pictures/before/san-francisco/spawn-presidio-tunnel-tops.png) | [PNG](pictures/after/san-francisco/spawn-presidio-tunnel-tops.png) |
| San Francisco | flyer-150m | [PNG](pictures/before/san-francisco/flyer-150m.png) | [PNG](pictures/after/san-francisco/flyer-150m.png) |
| Las Vegas | the-boulevard-north-from-harmon | [PNG](pictures/before/las-vegas/the-boulevard-north-from-harmon.png) | [PNG](pictures/after/las-vegas/the-boulevard-north-from-harmon.png) |
| Las Vegas | welcome-sign | [PNG](pictures/before/las-vegas/welcome-sign.png) | [PNG](pictures/after/las-vegas/welcome-sign.png) |
| Las Vegas | flyer-150m | [PNG](pictures/before/las-vegas/flyer-150m.png) | [PNG](pictures/after/las-vegas/flyer-150m.png) |
| Los Angeles | hollywood-boulevard | [PNG](pictures/before/los-angeles/hollywood-boulevard.png) | [PNG](pictures/after/los-angeles/hollywood-boulevard.png) |
| Los Angeles | steep-street-innsdale-drive | [PNG](pictures/before/los-angeles/steep-street-innsdale-drive.png) | [PNG](pictures/after/los-angeles/steep-street-innsdale-drive.png) |
| Los Angeles | flyer-150m | [PNG](pictures/before/los-angeles/flyer-150m.png) | [PNG](pictures/after/los-angeles/flyer-150m.png) |
| Tampa | downtown-street | [PNG](pictures/before/tampa/downtown-street.png) | [PNG](pictures/after/tampa/downtown-street.png) |
| Tampa | spawn-ybor-city | [PNG](pictures/before/tampa/spawn-ybor-city.png) | [PNG](pictures/after/tampa/spawn-ybor-city.png) |
| Tampa | flyer-150m | [PNG](pictures/before/tampa/flyer-150m.png) | [PNG](pictures/after/tampa/flyer-150m.png) |

Matched overview sheets; the individual full-size frames are linked above.

| City | Before, medium | After, medium |
| --- | --- | --- |
| Miami | ![Miami before](pictures/before/miami/sheet.png) | ![Miami after](pictures/after/miami/sheet.png) |
| San Francisco | ![San Francisco before](pictures/before/san-francisco/sheet.png) | ![San Francisco after](pictures/after/san-francisco/sheet.png) |
| Las Vegas | ![Las Vegas before](pictures/before/las-vegas/sheet.png) | ![Las Vegas after](pictures/after/las-vegas/sheet.png) |
| Los Angeles | ![Los Angeles before](pictures/before/los-angeles/sheet.png) | ![Los Angeles after](pictures/after/los-angeles/sheet.png) |
| Tampa | ![Tampa before](pictures/before/tampa/sheet.png) | ![Tampa after](pictures/after/tampa/sheet.png) |

Proving ground: [before, medium](pictures/before/proving-ground.png) → [after, medium](pictures/after/proving-ground.png). [Low poly](pictures/tiers/proving-lowpoly.png), [high](pictures/tiers/proving-high.png), [ultra](pictures/tiers/proving-ultra.png).

| Before, medium | After, medium |
| --- | --- |
| ![Proving ground before](pictures/before/proving-ground.png) | ![Proving ground after](pictures/after/proving-ground.png) |

| City, same 150 m camera | Low poly | High | Ultra |
| --- | --- | --- | --- |
| Miami | [lowpoly](pictures/tiers/lowpoly/miami/flyer-150m.png) | [high](pictures/tiers/high/miami/flyer-150m.png) | [ultra](pictures/tiers/ultra/miami/flyer-150m.png) |
| San Francisco | [lowpoly](pictures/tiers/lowpoly/san-francisco/flyer-150m.png) | [high](pictures/tiers/high/san-francisco/flyer-150m.png) | [ultra](pictures/tiers/ultra/san-francisco/flyer-150m.png) |
| Las Vegas | [lowpoly](pictures/tiers/lowpoly/las-vegas/flyer-150m.png) | [high](pictures/tiers/high/las-vegas/flyer-150m.png) | [ultra](pictures/tiers/ultra/las-vegas/flyer-150m.png) |
| Los Angeles | [lowpoly](pictures/tiers/lowpoly/los-angeles/flyer-150m.png) | [high](pictures/tiers/high/los-angeles/flyer-150m.png) | [ultra](pictures/tiers/ultra/los-angeles/flyer-150m.png) |
| Tampa | [lowpoly](pictures/tiers/lowpoly/tampa/flyer-150m.png) | [high](pictures/tiers/high/tampa/flyer-150m.png) | [ultra](pictures/tiers/ultra/tampa/flyer-150m.png) |

The finish study is [here](pictures/studies/medium-default/sheet.png), with each native image alongside it. Half-kilometre fields at 150 m: [grass](pictures/studies/medium-default/grass-field-150m-0.png), [sand](pictures/studies/medium-default/sand-field-150m-0.png), [asphalt](pictures/studies/medium-default/asphalt-field-150m-0.png). Frames `-0` through `-4` translate the camera by 25 cm per frame while holding the lighting clock fixed.

The software reprojection measurement compares the same ground points between those frames, including bilinear reconstruction and quantization. Mean RGB error is below 0.44 of one display byte; the worst 95th percentile is below 1.49 bytes. This supports stability for these tested positions and footprints, not a claim about every camera or GPU. [Raw motion measurements](pictures/studies/medium-default/motion.json).

At street distance, sand, grass and aggregate read separately, and concrete, brick, rust and painted finishes replace the checker on ruins. The 150 m views retain broad weather and city colour rather than oversized grain. I did not see periodic field stripes in the saved views. Regular masonry joints still repeat locally, as construction does; this is not a unique texture for every brick. Hard land-cover edges and the existing building/vegetation silhouettes remain the largest visual limits.

## Cost

Actual BC7/BC5, ASTC and RGBA files were encoded through the repo's encoders, with two workers in one job. [Exact byte counts, dimensions and hashes](evidence/texture-cost.json).

| Tier | BC / ASTC additional payload and residency | Base / normal / packed sides | RGBA fallback | Added draws / triangles |
| --- | ---: | --- | ---: | ---: |
| Low poly | 0 | none | 0 | 0 / 0 |
| Medium | 3,145,808 B (3.00 MiB) | 1024 / 1024 / 512 | 13,981,010 B (13.33 MiB) | 0 / 0 |
| High | 12,582,992 B (12.00 MiB) | 2048 / 2048 / 1024 | 13,981,010 B (13.33 MiB) | 0 / 0 |
| Ultra | 12,582,992 B (12.00 MiB) | 2048 / 2048 / 1024 | 13,981,010 B (13.33 MiB) | 0 / 0 |

These are the complete requested mip prefixes, excluding the shared file header, manifest and HTTP overhead. The first compressed step is about 16 KiB for all three maps. There are no region-mask downloads. High has twice medium's surface resolution. Ultra shares this atlas ceiling and shows more through its existing geometry, reach and shadow settings. The portable RGBA variant is capped at 1024 by the engine, so software high/ultra captures cannot demonstrate the GPU's 2048 texture detail.

Natural surfaces use nine texture reads near the camera, up to eighteen while fading to the cell average, and three once fully coarse. Directional finishes use three, up to six in the fade. Macro noise and shared PBR lighting add arithmetic. This is a real fragment cost even though draw counts do not change. A phone GPU timing is still required.

Flyer camera costs, shown as **draws / millions of triangles**. Each capture has its full `rendering*.json` alongside it.

| City | Low poly (2048 / 2 M budget) | Medium (1024 / 2 M) | High (2048 / 4 M) | Ultra (4096 / 8 M) |
| --- | ---: | ---: | ---: | ---: |
| Miami | 714 / 0.695 | 954 / 1.045 | 1575 / 1.817 | 2309 / 2.616 |
| San Francisco | 758 / 1.050 | 990 / 1.385 | 1532 / 2.702 | 2233 / 4.355 |
| Las Vegas | 612 / 0.964 | 693 / 1.251 | 982 / 1.945 | 1350 / 2.841 |
| Los Angeles | 865 / 0.797 | 994 / 1.067 | 1378 / 1.563 | 1859 / 2.294 |
| Tampa | 646 / 0.388 | 756 / 0.533 | 1133 / 0.694 | 1426 / 0.976 |

The three medium stress views over the 1024 draw allowance are Miami's downtown (1239), San Francisco's Painted Ladies (1423) and Hollywood Boulevard (1299). Their before counts are identical. All fifteen medium views fit the two-million triangle allowance. I tried the existing vegetation squeeze under draw pressure; it still missed the limit and reduced tree detail, so that unrelated policy change was removed. The requested draw-budget criterion is therefore not fully met.

The proving-ground camera uses 260 draws / 138,415 triangles on low poly, 399 / 230,465 on medium, 726 / 453,929 on high, and 863 / 659,943 on ultra. These all fit their tier budgets. Software capture/build times in the logs measure this machine's offline renderer and are not phone frame times.

## Verification

`bun run check` was run after the final code change. Pack, policy and type checks passed. The final test run reported **1,653 pass / 3 fail** across 280 files in 345 seconds: [full output](evidence/check.txt).

- `listen.test.ts` and `sockets.test.ts` cannot start `Bun.serve` on port 0 in this sandbox (`EADDRINUSE`). These also failed in the preceding full run, which had 1,654 passing tests and no other failures.
- The final run additionally timed out the existing 20-minute wild-flyer simulation in `flyers.test.ts`: 152 seconds against its explicit 60-second limit. The check runner reported host load 60 on 10 cores and waived its overall time budget using its existing load rule. No timeout, budget, test exclusion or expected hash was changed for this work.

An isolated rerun, `bun test tests/integration/flyers.test.ts`, also exceeded the unchanged 60-second limit for that simulation (79 seconds): [output](evidence/flyers-isolated.txt). The earlier full run passed this test. The latest check is nevertheless failed, and must be rerun on a machine that permits the socket tests and has enough available CPU; this report does not claim the required green check.

The existing 300-frame pins remain `1425549560` and `2182034391` in `tests/unit/scene.test.ts`, and `e73ea001` and `c7cb77a9` in `tests/integration/assets.test.ts`. No expected frame hash was edited. Added tests cover palette classification, continuous noise, near/far sampling bounds, unit normals, isolated compression blocks and city bump tuning.

The one-shot [WebGL compiler probe](../../../tools/surfaces/compile.ts) uses a local HTML file and exits. Installed Chrome aborts with exit 134 before returning a report in this environment. Fake-context shader contract tests cover all tier/format programs, but are not a substitute for a real compiler or GPU/software image comparison. No phone hardware measurement was available. Port 8787 was left alone and no long-lived server was started.

## Next

1. Run the real WebGL probe and matched GPU/software captures on an allowed desktop, then measure medium on the owner's phone with these cameras. Tune sampling cost from those measurements.
2. Address the pre-existing city draw overruns through batching, with its own geometry and visibility checks; do not silently drop cover or widen budgets.
3. Add a dedicated terrain material channel and edge blending so colour aliases no longer decide whether a patch is road, mud or gravel.
4. Author independent height/normal information and larger directional variants where close inspection still exposes repeated masonry or timber details.

## Decision rows for the coordinator — unnumbered

| Decision | Reason / consequence |
| --- | --- |
| One shared sixteen-finish atlas, streamed through ordinary material residency | Medium adds 3 MiB compressed and no draw calls. |
| Separate terrain and static palette aliases; map format unchanged | Useful immediately with D253, with documented classification ambiguity. |
| Absolute metre projection, stochastic natural materials and macro weather | Works on boxes/slopes without authored UVs; features remain attached to the world. |
| Block-isolated distant cell means and guarded explicit mip sampling | Prevents unrelated atlas colours bleeding into each other at distance. |
| Family, group and city tuning in `content/surfaces.ts` | Owner can change whole sets without rebuilding maps or art. |
| Low-poly shader, texture policy and geometry governor preserved | No low-poly repin; existing city draw overruns remain visible in the report. |

No commits were made. `planning/decisions.md` was not edited.
