Round 1 revises only the eye surround and brow. The 20 delivered maps for **skin, scutes, claw and mouth are byte-for-byte unchanged**, and their `study.json` entries are unchanged. The accepted amber iris, round black pupil and inner wet rim have **zero changed base pixels**. The eye region map is also pixel-identical. [Preservation measurements](checks/round1_metrics.json) compare against the frozen review baseline in [superseded/source/round1_accepted/](superseded/source/round1_accepted/); the previous report is retained there.

The eye remains an opaque, non-tiling **2048 × 2048 panel spanning 50 mm**, with a nominal 18 mm iris. The eye plus inner wet rim still measures 19.287 × 18.896 mm. Black marks the eye and the lid rim's inside edge; pure red marks the lid skin and surrounding fuzz, all in region 0.

The ornamental bare-skin field has been replaced with short, fine face fuzz lying **left to right, beak to nape**, through all four panel edges. Only the narrow finely wrinkled lid remains bare. The irregular transition begins about **1.22 mm** outside the wet edge and reaches full fuzz by **2.03 mm**. The intended filament length is 2–4 mm; the measured dominant strand axis is 5.4° above horizontal, with natural local variation. A single soft upper fold rises **0.38 mm** and carries fuzz on its outer shoulder. Its inward face shades the upper lid through occlusion. There is no brow shadow in the base.

**Sources.** Two sequential edits used the built-in `image_gen.imagegen` tool. The first replaced the lace with fuzz; the second corrected a diagonal lie to horizontal. Both untouched 1254-square outputs, exact prompts and hashes are retained: [initial prompt](superseded/source/prompt_eye_surround_round1.txt), [final prompt](source/prompt_eye_horizontal_round1.txt), [final generated source](source/eye_surround_round1.png), and [provenance](superseded/source/provenance_eye_round1.json). The generated iris is never used: `build.py` reconstructs the accepted iris from the unchanged original source and mapping.

I reread `COMMON.md`, this study's brief and report, and `ref/DESIGN.md`; inspected both concept head views and the fuzz study's current face/base and short-fuzz source. The fuzz source was a character reference for generation. Nothing in the fuzz study was written. No external reference images were searched or downloaded, and Blender was not used.

| Delivered eye layer | Construction this round |
|---|---|
| [eye_base.png](eye_base.png) | Edited/generated surround, registered by the iris boundary. Broad illumination removed after excluding the dark eye from the filtering field. Fine strand tips and root-gap value drawing retained in neutral albedo. Original finely wrinkled skin retained only within the narrow lid transition. Accepted iris and inner rim reconstructed exactly. |
| [eye_height.png](eye_height.png) | Computed smooth corneal cap, shallow lid, soft upper fold and very shallow filament relief. Iris fibres remain pigment only. Genuine 16-bit greyscale; black-to-white still encodes 1.50 mm, with 0.730 mm occupied. |
| [eye_normal.png](eye_normal.png) | Recomputed from the quantized delivered height at the 50 mm physical span, OpenGL convention. |
| [eye_packed.png](eye_packed.png) | Computed local height occlusion plus the extra ambient sky blocked by the brow, sampled equally in 16 directions. Dry fuzz roughness averages 0.900; skin is about 0.620; cornea remains 0.075 and inner wet rim 0.180. Metalness is zero everywhere. |
| [eye_regions.png](eye_regions.png) | Same pure black/red categorical map as before; no antialiasing or changed pixels. |

The additional aligned [element layers](source/eye_layers.json) retain the fuzz transition weight, additive brow height and brow occlusion separately for reuse. They are rebuilt with the eye and rotate with `--panel-turns`. `--eye-lid-mm` controls the bare rim, `--eye-brow-mm` controls the fold's height, and `--eye-mm` controls eye size. Current defaults are recorded in [study.json](study.json).

**Final measurements.** All ordinary checks and the additional round-1 preservation checks pass.

| Eye check | Result |
|---|---|
| Region 0 mean, linear | 0.500003; neutral mean corresponds to sRGB 188 |
| RGB channel spread in dyed pixels | 0 |
| Region 0 quadrant spread | 0.086% |
| Whole-base quadrant spread | 0.656% |
| Base/normal tangent correlations | −0.0046 / −0.0094 |
| Independent eight-direction light correlation, whole panel | −0.102; limit is 0.3 |
| Game normal/height correlation X / Y | 0.97806 / 0.99700 |
| Maximum normal unit-length error | 0.006515 |
| Mean upper / lower bare-lid AO | 0.9645 / 0.9836 |
| Additional mean upper-lid occlusion from the brow | 0.0303; zero on the lower control region |
| Illegal region colours / nonzero metalness | 0 / 0 |

The upper-lid shade is verified against the same height field with the additive brow removed. This distinguishes the fold's shadow from the pre-existing lid/cornea concavity. The game's importer reads the eye surround at mean grey 0.4996 after mip filtering.

Commands run from the pteranodon folder:

```sh
python3 tex/studies/skin/build.py --sets eye
python3 tex/studies/skin/check_round1.py
python3 tex/studies/skin/check.py
bun tex/studies/skin/engine_check.ts
python3 tex/studies/measure.py skin
bun tex/studies/skin/panel_look.ts
```

`check.py`, the actual game material importer/height-normal check, and the independent art-director measurement all pass for all five sets. Only the eye was rebuilt. Details: [map metrics](checks/metrics.json), [game metrics](checks/engine_metrics.json), [independent metrics](checks/measure.json), and [round-1 audit](checks/round1_metrics.json).

**Visual review.** The [round-1 comparison](checks/eye_round1_review.png) puts the registered source beside the delivered unlit neutral base, neutral relight and charcoal relight, with 1:1 crops across the changed upper lid and fuzz. Fine strand drawing survives in the base; the relight adds a soft upper fold without the previous ornamental skin rings. The [two-light/dye sheet](checks/eye_review.png) and [concept-scale comparison](checks/concept_scale.png) were inspected. Native 120 px animal-density and 12 px one-tenth-density previews are retained in `checks/` for charcoal, lime, near-black and pale dyes.

The eye is `form: none`, so the shared `look.ts` skips it. The existing [panel renderer](superseded/panel_look.ts) uses the game's shader, material importer, rgba mips, lights and camera density. Its [final eye sheet](checks/panels/eye.png) was inspected at 0.15 m for detail, 0.5 m from two angles, 1.5 m and 5 m. Close up, the surround has fine horizontal pile and a narrow lid; the amber/pupil remains distinct in each dye. At 1.5 m the fine surround quiets down, and at 5 m the panel resolves to a small clean dark/amber point. No shared renderer or accepted material was changed.

The four accepted sets retain their original construction and measurements:

| Set | Unchanged source treatment | Span / encoded height | Dyed-region mean |
|---|---|---|---|
| skin | Generated irregular pebbles, rescaled and quilted with minimum-error seams; fine pigment drawing and softened relief | 200 mm / 0.22 mm | Region 2: 0.5000 linear |
| scutes | Generated transverse plates with pebbled gaps, varied patches and repaired wraps | 200 mm / 0.32 mm | Region 2: 0.5000 linear |
| claw | Generated curved dark horn grain, 45 mm centreline, polished worn point; plain horn margin | 60 mm / 0.10 mm | Undyed |
| mouth | Generated longitudinal mucosal ridges, made periodic, pale pink-grey with shallow relief | 200 mm / 0.10 mm | Undyed |

All their aligned base/height/normal/packed/region maps, source originals, scale and build branches are preserved. Their earlier renderer review and fuller construction notes remain in the [previous report](superseded/source/round1_accepted/REPORT.md).

**Limits.** The surround source is 1254 square, so the delivered maps are resampled derivatives rather than native 2048 artwork. The 2–4 mm filament range is the source calibration, not an exhaustive measurement of each overlapping strand. Very dark dye suppresses the finest pile at distance. The shallow fold is represented by height/normal and ambient occlusion; final geometry is still needed for a true overhanging silhouette. This is a material panel, not a finished-animal UV review.

This revision took approximately 12.4 minutes after the source/baseline snapshot, including generation, building, checks, game preview and reporting; initial instruction/reference rereading preceded that timer. [Timing record](superseded/source/timing_eye_round1.json). The original study's 23.3-minute session is recorded separately in `superseded/source/timing.json`.

## Files

Round 2 accepts all five sets. On the animal, the head painter will carry the fuzz study's face fuzz up to the thin
lid; this panel records the join.

The accepted build reads six untouched originals: `source/skin_original.png`, `source/scutes_original.png`,
`source/claw_original.png`, `source/eye_original.png`, `source/mouth_original.png`, and
`source/eye_surround_round1.png`. Their prompts remain in `source/prompts.json` and
`source/prompt_eye_horizontal_round1.txt`. Unused revisions, baselines, provenance, timings and review scripts are
archived in `superseded/`. The build's only changes relocate the four derived eye-layer files into `source/` and
adjust their relative source link.

The local `.gitignore` lists all 25 delivered PNGs and those four derived files individually. They remain on disk;
the shared ignore already excludes `checks/`, `superseded/` and Python caches. `study.json` remains included, with
its accepted metadata and original invocation history preserved.

After deleting all 29 listed files, the clean build regenerated every one. SHA-256 matched **all 25 delivered
pictures byte for byte**, as well as all three derived eye images. All six originals and all 106 existing check
files are unchanged. File-access auditing confirmed no input from ignored or superseded files. The local audit is
[superseded/tidy_audit.json](superseded/tidy_audit.json). Repository payload: 18 files, 17,901,264 bytes (17.07 MiB), excluding ignored files.
