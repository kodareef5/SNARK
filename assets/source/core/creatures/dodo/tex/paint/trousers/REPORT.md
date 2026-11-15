# Trouser cards

Painted the `trousers` card rectangle as one continuous shaggy fall, from the twelve accepted fringe specimens. There are 35 overlapping feather placements in three beds, with unequal spacing, lengths, widths, directions and mirroring. The lower edge consists of the original locks and branched wisps. No new imagery was generated, and the accepted study was not changed.

## Placement and layers

The strip is **227 mm along × 59 mm down**, with its roots at the top, following the revised group brief and the two rings now modelled around each thigh. The group brief was updated during painting; its dimensions replace the older 288 × 48 mm dimensions still listed in the shared brief. Its atlas rectangle is `[0, 0, 2048, 328)` in pixel coordinates, corresponding to UV `[0, 0.84, 1, 1]`. Only that rectangle is painted. Region 0 is pure red throughout it, including transparent gutters; there are no bars.

Whole feathers retain lengths of 60.65–89.33 mm and widths of 29.06–42.94 mm. Their upper vanes are tucked above the card boundary, rather than compressing the whole feather into 59 mm. The three beds have 13, 12 and 10 placements. Feather directions vary by up to 13 degrees either way. Placements repeat horizontally across the atlas boundary so the leg collar closes without a seam. A common 672-pixel horizontal translation places the repeat boundary between wisp clusters; no shape or overlap is changed. The card's top remains continuously covered after reduction; the free ends stop before its bottom boundary.

The source colour, alpha, height and shaft come from the accepted individual PNG layers in `tex/studies/trousers/source/`, located by `elements.json`. Base colour retains the barbs and gaps between locks. Broad corrections at 3 mm remove placement-related brightness drift and correlation with the relief; fine-barb contrast retains 99.995% of its pre-correction value, with correlation 0.999979. The alpha is not blurred or retraced.

Height combines the accepted fine relief with gentle source-following lock rounding and soft overlap. Its full encoding is **2 mm**, recorded in `layers/layers.json`; occupied texels use 0.528–1.507 mm. Height and colour extend through transparent areas within the rectangle, avoiding a zero-height cliff or a dark filtering fringe. Fine occlusion is calculated from physical height, independently of illumination. Dry roughness follows the accepted vane and shaft treatment.

`layers/` contains the five `cards_*` maps and five empty `dodo_*` maps. This group owns no opaque pieces. Base maps are RGBA8 sRGB, heights are grayscale16 linear, roughness and occlusion are grayscale8 linear, and regions are RGB8 categorical. No normal map is delivered; the composer creates it. The placement manifest records all physical dimensions, source choices and buried root positions.

## Rebuild and checks

Run these commands from the dodo folder:

```sh
python3 -B -I tex/paint/trousers/paint.py
python3 -B -I tex/paint/compose.py --out tex/paint/trousers/checks/composed
python3 -B -I tex/paint/trousers/check.py
```

`--width-mm` and `--depth-mm` allow future model-size changes without stretching the source feathers. Painting takes about two seconds. A clean rebuild, with `layers/` removed first, matched **all ten PNGs and both JSON manifests byte for byte by SHA-256**. `checks/determinism.json` records both sets of hashes. The build reads the accepted study elements directly; it needs no generated files from a preceding paint run.

Final checks passed:

| Measurement | Result |
| --- | --- |
| Mean grey, linear | 0.49999999 |
| RGB channel spread | 0 bytes |
| Four quarter means | 0.499993–0.500006 |
| Largest absolute base/normal correlation | 0.0000609 |
| Height standard deviation | 0.221 mm |
| Occlusion mean / minimum | 0.953 / 0.780 |
| Roughness range | 0.871–0.922 |
| Horizontal seam ratios: colour / height / alpha | 0.573 / 0.554 / 0.604 |
| Painting outside owned rectangle or onto opaque pieces | None |
| Accepted source hashes | All match |

At the composed 512 atlas size, the first eight rows of the strip are fully solid at the 0.5 alpha cut. Every column contains feathers, the bottom row is clear, and the lowest surviving tip in each column varies from 24.10 to 51.45 mm below the root, with a 5.65 mm standard deviation. The composed alpha exactly matches the expected reduction, and its normal bytes exactly match an independent calculation using the composer's convention.

Reviewed slate, near-white, near-black, pink and lime unlit and under opposite lights; the layout footprint; horizontal repeats; the 512 and 128 atlases; and the strip at a 200- and 50-pixel bird scale. At 512 the edge still separates into locks and wisps. At 128 the larger locks survive; at 50-pixel bird size the strip becomes a soft uneven silhouette.

`checks/position_views.png` and `checks/leg_closeups.png` show the composed material from front, side and back. Opaque context is projected through the supplied 16-bit position maps and mirrored. The trouser cards use 384 actual triangles from the existing bake export, with the composed 512 atlas and alpha cut at 0.5. These Python previews required no Blender run. The optional geometry snapshot in `checks/card_surface.json` is preview data, never a painting input. `checks/concept_scale.png` compares the concept lower body with an accepted-material/card swatch at 1500 pixels per metre.

## Integration and limits

- The body painter had not produced `tex/paint/body/layers/` at final review. I checked for it during painting and used the accepted trouser tile for the material comparison. The cards share its original feather family, neutral mean and dry roughness, but the final join with the painted lower flanks still needs review when that paint exists.
- The revised model uses the `trousers` rectangle on two rings around each thigh. Other loose body-edge tufts use the `body` rectangle. No other group's rectangle or model file was changed.
- `compose.py` uses a shared 190 mm atlas span for card normals. This rectangle's actual texel size is about 0.111 × 0.180 mm, versus its shared 0.093 mm, so the composed slopes are about 1.2 times the physical slopes across and 1.9 times down. Height remains authored in real millimetres. Both physical strip relights and the actual composed normals were reviewed; per-rectangle normal metrics would require a composer change.
- The accepted family is finer and more divided than the concept's broad lower-body vanes. The cards preserve that accepted family. Subpixel barbs simplify at distance, and Python diffuse previews do not simulate transmission through down or replace the game's renderer.

All work and generated previews stay in this group's folder. `layers/` and `checks/` are ignored by Git.
