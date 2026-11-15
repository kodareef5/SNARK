# Final Forkleaf atlas sources

From the atlas directory, run:

```sh
python3 build_atlas.py
python3 check_atlas.py
```

Both commands are deterministic and offline. Python 3, Pillow, NumPy and SciPy
are required; `requirements.txt` records the package versions used. The checker
validates the delivered atlas, then runs the builder in an empty temporary
directory containing only the active inputs. It compares SHA-256 hashes of all
five maps, layout, generated metadata, prepared cutouts, elements and masks.
No earlier delivery, reference atlas or historical hash baseline is required.

## Inputs and provenance

- Eighteen `*_original.png` files retain the full-resolution generated artwork:
  six sprays, two inner branches, three bunches, three loose leaves, fallen and
  stripped cutouts, and bark. They were made with the built-in image generation
  tool using the repository's botanical concepts as references.
- `prompts.json`, `inner1_edit.json`, `bunch_prompts.json` and
  `original_prompts.json` retain the exact generation/edit prompts. The last
  file includes the prompts for the retained leaves, fallen/stripped cutouts
  and bark, copied out of the removed archive.
- `annotations.json` defines spray clusters, attachment points, unripe fruit
  and picking damage. `bunch_annotations.json` defines the hanging bunches'
  projected stalks, berry positions/radii, facing and overlap depths.
- `berry_base.json` controls neutral berry colour, bloom and catchlight values.
  `packed_materials.json` controls roughness and ambient occlusion.
- `preserved/` contains only the base, 16-bit height and packed material crops
  for `fallen1`, `stripped1` and `stripped2`, plus their placement geometry.
  These nine crops remain active build inputs, preserving accepted artwork
  without resampling. Their full generated originals remain as provenance and
  are hashed by the build. Normal and region crops are unnecessary: the build
  derives those layers. Bark is rebuilt directly from its generated original.

There are no inactive sources, superseded cutouts or preserved atlas deliveries
in this directory. Prompt records and dependency documentation are intentionally
kept even though they do not supply image pixels.

## Berry finish and material contract

All 535 ripe spheres have neutral albedo with a broad soft upper bloom. The cap
covers the upper 48% of the diameter, reaches approximately 160–164, and fades
smoothly into the existing shoulder/body shading. Body grey remains
approximately 78–82 and the lower rim approximately 58–62. The broad cap takes
the maximum of the new bloom and the existing finish, retaining every lower-half
pixel. Existing calyx dots retain their exact values of
70, 71 or 73. Unripe fruit keeps its original green/yellow-green albedo.

Each of the 530 forward-facing ripe berries has one three-texel catchlight:
a 2 × 2 L-shaped footprint at the upper left, with values 242, 234 and 234.
These texels remain inside opaque berry alpha but are excluded from region 0,
so dye never changes their near-white colour. Five turned-away berries have
no catchlight. Region 0 is hard red and covers all other visible ripe pixels,
including calyx dots and antialiased sphere edges. Everything else is black.

Catchlight roughness is 89/255 (approximately 0.35). Every other berry texel
retains its existing roughness, within 0.62–0.70. AO, metalness, height and
normals are unaffected by the finish. Leaf faces retain matte roughness.

The finish is applied after colour padding, preserving all transparent RGB.
The existing 40-pixel berry extension therefore retains its neutral body/calyx
colour, without the new bloom or white glints; non-berry padding remains the
nearest visible colour. The checker verifies this rule within 32 pixels.

Physical scale is 1300 px/m. Height spans 16 mm and normals use OpenGL +Y up,
derived from the quantized 16-bit height. Bark has a 600 mm vertical span and
periodic vertical derivatives. Leaf relief is inferred from source colour
boundaries, local domes and vein detail; berry relief is explicitly spherical.

## Regenerated outputs

- `packing.json`, `geometry.json`: cell geometry, projections and anchors.
- `prepared/`: cleaned and scaled originals before fruit and picking overlays.
- `elements/`: final RGBA sprites, berry IDs, unripe/damage/stalk/leaf masks.
- `berries.json`: each sphere's centre, radius, cluster, ripeness and facing.
- `build_metadata.json`: physical conventions and hashes of all 18 originals.

The final five maps and `layout.json` are written in the parent directory.
The checker reads every generated output for exact rebuild verification and
independently checks sphere ownership, calyx colour, catchlight placement,
region membership, physical height, alpha, rectangles, padding and twin
agreement. Review images and measurements are written to `../checks/`.
`berry_dyes_distance.png` pairs native-size bunches and a spray with the same
scene at 25% size, averaged with its dark leaf backdrop for a distance check.
