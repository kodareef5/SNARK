# Dust, grit and water

Delivered the seven named runtime textures: `dust_1.png`–`dust_4.png`, `grit.png`, `drop.png`, and `ripple.png`. Together with `preview.png`, these are eight PNG deliverables in this folder. All runtime textures are **1024 × 1024, 8-bit RGBA, straight alpha**, with exactly equal R, G and B channels.

## Method

This is a hybrid of generated source artwork and deterministic texture authoring. I used the **built-in imagegen tool**, one image per subject, without the API/CLI fallback. The complete final prompt set and original output locations are in [sources.json](sources.json); the seven untouched source images are preserved in [source_art](source_art/). They are working sources, not the runtime textures.

The initial generated dust looked too opaque and cloud-like. The final dust uses a newly authored opacity field: several irregular shallow density lobes, gently warped at different scales, with independent seeds for each puff. Small variations from the generated artwork's luminance contribute fold detail. Continuous opacity, porous edges and an irregular falloff replace the generated cutout silhouette. RGB stays near-white, with restrained overhead lighting; there is no painted ground or cast shadow. The densest pixels remain translucent. The four variants have different lobe arrangements, density patterns and outer wisps.

For grit, I extracted individual grain shapes from the generated source, reduced the gravel-sized pieces, and scattered 145 grains with a round distribution concentrated toward the center. A few overlaps leave 138 connected components at alpha > 64. The space between grains is transparent; there is no dusty veil joining them.

The drop retains the generated highlight and internal shading, converted to exact grayscale. Its silhouette is centered and circular, with a solid interior and a six-pixel soft rim. The ripple's generated halo did not meet the brief, so its final shape is authored mathematically: one narrow Gaussian crest at approximately 377 pixels radius, with subtle variation in brightness and less than two pixels of radial variation. Everything beyond the narrow crest band, including the entire center, is transparent.

RGB remains neutral even in fully transparent pixels to avoid black fringe contamination during filtering. Alpha is not premultiplied in the saved textures.

## Checks

Automated results are saved in [checks.json](checks.json). All seven textures passed square dimensions, RGBA format, exact grayscale, centered alpha mass, and a completely transparent border exceeding the required 62 pixels on every side.

| Texture | Smallest clear margin | Maximum alpha / 255 |
| --- | ---: | ---: |
| dust_1 | 104 px (10.2%) | 197 |
| dust_2 | 107 px (10.4%) | 202 |
| dust_3 | 98 px (9.6%) | 178 |
| dust_4 | 119 px (11.6%) | 199 |
| grit | 166 px (16.2%) | 255 |
| drop | 174 px (17.0%) | 255 |
| ripple | 124 px (12.1%) | 199 |

Dust has 178–202 distinct nonzero alpha levels, with no fully opaque pixels. The ripple's clear center and exterior are also checked explicitly. I visually inspected tinted dust, the enlarged engine-size versions, actual 128/32-pixel samples, the water pair, and the repeated rings. The four variants have visibly different density patterns, with no rectangular boundary or hard baseline in the compositions.

## Preview

[preview.png](preview.png) is a **3264 × 9370** review sheet. View at 100% zoom to judge actual pixel sizes. It contains every dust/grit texture at native **1024 pixels**, **128 pixels**, and **32 pixels**, on all three specified grounds. It also shows **128 → 250 pixel bilinear enlargement**, alpha inspection panels, three twelve-puff rings, and water samples.

The exact RGB tint multipliers are sand `#c9b48a`, dry soil `#8a7356` and pale stone `#b5b2aa`. Background RGB is each swatch multiplied by 0.43. Compositing uses ordinary source-over alpha, without additive blending. Texture reduction uses area averaging in premultiplied form; enlargement uses bilinear filtering. The calculations use the stored RGB values, without a linear-light color conversion.

Each ring contains exactly twelve puffs: three instances of each dust texture. Seeded random rotation, scale, position jitter and opacity give an inspectable repetition example. Placement is identical across the three grounds for comparison. Exact parameters are saved in [ring_layout.json](ring_layout.json).

A smaller [overview](source_art/preview_overview.png) and the [actual small-size checks](source_art/qa_small_sizes.png) are included for faster review. The native dust and water inspection crops are also in `source_art/`.

## Limitations and further changes

The rings approximate the ground-plane arrangement described in the brief; they are not captures from the game. I have not tested its texture compression, color-space settings, blend state, particle animation or one-second lifetime. Those can affect the final appearance even when the PNGs are correct.

At 32 pixels, fine grit becomes very faint and the ripple is a delicate subpixel line. I kept those features small rather than turning sand into gravel or making the ripple a thick hoop. If distant water impacts need more emphasis, I would first tune the emitter's scale/opacity in the game. Likewise, I would judge overlapping dust opacity during an actual fall before changing these source textures. No further texture changes are pending after the static review.

## Rebuild

Both scripts are kept here and use the local source images; rebuilding needs no generation service or network access. Dependencies: Python 3, Pillow, NumPy and SciPy.

```sh
python3 build_assets.py
python3 build_preview.py
```

[build_assets.py](build_assets.py) writes the seven runtime textures and runs the structural checks. [build_preview.py](build_preview.py) writes the preview, inspection images, and seeded ring layout. The original `BRIEF.md` is unchanged.
