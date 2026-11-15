# Fern atlas report

Delivered eleven elements in four aligned 2048 × 2048 maps: six green fronds, two dead fronds, two young crosiers, and the crown column. All fronds are flat, upright cutouts, ready for the game's card-bending script. No regions map is needed or supplied.

| File | Construction |
| --- | --- |
| `fern_base.png` | 8-bit sRGB RGBA. Eleven individually generated sources, clean opaque interiors, a 1–2 pixel antialiased silhouette, and nearest edge colours extended 40 pixels into transparency. Beyond that, an 8-pixel transition leads to each element's mean colour. |
| `fern_height.png` | 16-bit grayscale. Silhouette-derived domed blades, raised rounded rachises, fine source-aligned vein detail, dry-leaf corrugation, and rounded fiddleheads. Transparent pixels are exactly zero. |
| `fern_normal.png` | 8-bit RGB, tangent-space OpenGL (+Y). Computed from the saved, reloaded 16-bit height at physical scale; no separately generated normals. |
| `fern_orm.png` | Linear 8-bit RGB: local concavity and inner-frond occlusion, material-specific roughness, zero metalness. Fresh leaves are smoother, old leaves duller, brown edges drier, and dead blades/crown roughest. |
| `layout.json` | Nonoverlapping exclusive rectangles, surface anchor/tip coordinates, physical lengths, and the crown's bark role. |
| `source/` | Twelve unmodified full-size originals, including the superseded damaged-frond version; eleven selected. Exact built-in imagegen prompts, layout/build specification, source hashes, processing metadata, and timing are retained. See `source/README.md`. |
| `build_atlas.py` | Deterministic local rebuild of all four maps and layout from frozen sources. Uses Pillow, NumPy, and SciPy. |
| `check_atlas.py` | Independent numerical checks and all review images; exits nonzero on failure. |
| `checks/` | Layer contact sheet, full-size and 256-pixel composites on three backgrounds, layout overlay, each of the eleven elements lit from two directions, lighting contact sheet, detail crops, crown seam inspection, measurements, and rebuild hashes. |

## Scale and design

The cutouts use **1400 pixels per metre**. Green fronds range from 0.55 to 1.10 m long and 0.14 to 0.26 m wide. Their measured bare stalk portions are approximately 17–21%. `frond1` is fresh yellow-green; `frond2` darker and older; `frond3` has a snapped, ragged tip and insect bites; `frond4` has scattered browning pinnae; `frond5` is narrow; `frond6` broad. Dead fronds are warm brown and grey-brown, about 0.79 and 0.54 m. Young fronds are about 0.32 and 0.23 m, with opposite-facing curls.

The crown occupies exactly `[1952, 0, 2048, 2048]`, is fully opaque, and covers **0.5 m vertically**. This specified exception corresponds to 4096 pixels/m; its normal gradients use that spacing. A narrow proportionate crop preserves the source fibre scale. Opposite edge neighbourhoods are blended, with matched edge values and slopes, so all four crown layers repeat vertically.

The height encoding's complete 0–65535 range represents **12 mm**; the largest occupied height is 9.456 mm. Normals use `normalize(-dH/dx, +dH/d_image_y, 1)` with centred finite differences and periodic vertical differences on the crown.

The supplied fern concept images and NOTES.md guided the simple paired pinnae, sword outline, pale crosiers, brown dry blades, and fibrous crown. The supplied wood layer sheet was reviewed as the material-set reference. No outside reference images or existing-game pictures were used.

## Checks and visual review

**119/119 checks pass.** See `checks/measurements.json` for individual results and each element's coverage, margins, roughness, physical-scale error, and alpha measurements.

- All formats, dimensions, element names, nonoverlapping rectangles, upward orientation, and alpha ownership pass. The smallest clear margin is 24 pixels.
- Every cutout is one connected component. Partial alpha occupies 1.959% of the atlas and lies only within the narrow silhouette band. There is no broad translucent haze.
- Every transparent pixel within 32 pixels of a cutout exactly matches its nearest edge colour. The actual extension is 40 pixels.
- Normal/height disagreement is at most 0.380°, with a surface mean of 0.171°; this is within 8-bit normal quantization. Metalness is zero throughout, and height is zero at alpha zero.
- First and last crown rows match exactly in base, height, normal, and ORM.
- A fresh rebuild produces byte-identical four maps and layout; hashes are in `checks/rebuild_verification.json`.

Reviewed `checks/layers.jpg`, `checks/layout_overlay.png`, the normal-lit contact sheet, unscaled detail crops, and the crown seam. The damaged tip reads clearly, dry pinnae have ragged and missing portions, and the crosiers remain distinct. The dark-grey, white, and mid-green previews remain clean at 256 pixels without black, grey, white, or neon fringes. These previews average RGB and alpha independently to exercise the game's stated mip behaviour. Fine veins disappear at that size, while the pinna spacing and whole-frond silhouettes remain readable. In the layout overlay, cyan circles mark anchors and gold circles mark tips.

## Rebuild and limitations

```sh
python3 build_atlas.py
python3 check_atlas.py
```

The builder does not require network access or another image-generation call. Twelve built-in calls were used, including one targeted damaged-tip revision. Most originals had genuine usable alpha but noisy RGB outside it; the revision returned a translucent white matte and is extracted by leaf/stalk chroma. All originals remain unchanged.

Relief is a controlled procedural reconstruction from silhouettes and source detail, not a measured botanical scan. The mature leaflet rhythm remains somewhat regular; the six variations improve outline, size, colour, age, and damage, but further hand-authored irregularity could improve close-up variety. Very fine hairs and the smallest gaps naturally lose detail in distant mips. Review here covers texture-space materials and mip composites; the assembled, bent in-game clump has not been rendered.

Elapsed wall time: approximately 15.9 minutes, including generation, assembly, revision, numerical checks, visual inspection, and rebuild verification. Timing is recorded in `source/session.json`.
