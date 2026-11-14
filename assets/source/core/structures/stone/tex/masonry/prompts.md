# Round three source prompts

Both images were generated with the built-in image tool. The files below are its unchanged 1254 × 1254 outputs. Earlier outputs and prompts are in `round2/source/` and `round2/prompts.md`.

## 1. Limestone pigment source

Saved as `source/limestone_pigment.png`.

Use case: photorealistic-natural. Asset type: unlit PBR pigment source for a survival game's rock-faced limestone masonry, to be cropped onto individually modelled stones. Generate a square, tightly cropped, orthographic macro material scan of one continuous weathered buff-grey limestone fracture surface, filling the entire frame edge to edge. Surface character: naturally broad irregular overlapping cleavage terraces and angular fracture grain, compact fine crystalline areas between coarse chalky pores, sparse ochre mineral blooms, tiny calcite flecks, subdued weathered grey crust, a few short blunt mason's punch scars. The material should feel like the limestone in stronghold concept art, heavy rough-cut sedimentary stone. Warm grey, sandy pale buff and restrained ochre, no blue. Flat cross-polarized diffuse albedo scan, completely uniform diffuse illumination; no directional highlights, no dark cast shadows, no overall gradient. Tonal mottling represents mineral pigmentation, not bevel lighting. No stone outlines, no masonry joints, no blocks, no border, no cracks through the whole surface, no long streaks, no fibrous or hairy grain, no decorative veins. Dense realistic mineral detail and irregular patches at several scales, not a noise filter.

## 2. Fracture displacement source

Saved as `source/limestone_fracture_height.png`.

Asset type: a grayscale scalar DISPLACEMENT / HEIGHT TEXTURE of rough-cut rock-faced limestone, for a PBR game material. Square full-frame texture, no grid or border. Show one continuous freshly fractured weathered limestone rock surface with closely nested irregular angular cleavage terraces, blunt broken ledges and tiny crystalline granular pits. Several scales: broad uneven faceted patches about 5 to 15 cm, smaller clustered chipped flakes, compact stippled mineral grain. This is a HEIGHT MAP, not a photograph: every pixel's grey value encodes actual surface elevation, pale grey means high and darker grey means low, with no directional illumination whatsoever. Use mostly middle grey through pale grey, with narrow scattered dark pit bottoms. Each ledge changes absolute grey value across its boundary, not a bright rim and shadow pair. Natural organic irregular cleavage polygons, overlapping and clustered, not evenly spaced craters, not a triangulated computer mesh, not rounded hills, not a Voronoi mosaic. Topographic millimetre relief, no whole-rock dome, no long cracks, no long striations, no hair, no masonry blocks or joints. No text, no labels, no color.

## Use in the build

The pigment source contributes restrained filtered colour. The second output is treated as scalar displacement artwork, detrended and rescaled to millimetres; it is not a measured scan. Each stone receives its own unwrapped, rotated crop. Fine mineral grain, pores, sparse punch marks, corner spalls, and mortar are built at 2048 pixels. No geometry crown, face tilt, or bevel illumination is extracted from either source.

## Round four — retained sources

No new image-generation calls or prompts were used. The approved round-three generated sources remain unchanged in `source/`, with an archival copy in `round3/source/`. The build preserves the actual delivered fine relief and roughness for 29 unchanged footprints, using the archived round-three maps and derivation data; fourteen new or reshaped stones use the same source-crop and native-detail method. Colour is regraded on a buff-to-ochre continuum and the macro height is fitted to the new off-centre crowns.
