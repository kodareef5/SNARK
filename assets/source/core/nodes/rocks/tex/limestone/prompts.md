# Limestone source prompts

All three calls used the built-in image generation tool, with `transparent_background: false`. These were new source images; the concept art guided the written specification. Every returned picture is preserved byte-for-byte in `source/`.

## 1. `source/weathered_relief.png`

Use case: photorealistic-natural.
Asset type: raw scalar relief source for a physically scaled tileable game limestone material. One square image only, no montage.
Create a detailed orthographic GRAYSCALE HEIGHT FIELD of rain and sea-spray weathered oolitic coral limestone. White means high stone, grey means midsurface, dark grey to black means deep small pores. This is actual elevation encoded as brightness, NOT a lit photograph, NOT a shaded render. No highlights, shadows, lighting or direction at all.
Entire image is uninterrupted rough carbonate rock skin. The square represents 45 cm across. Dense irregular interconnected pinholes and dissolution micro-pits 1–6 mm, scattered irregular steep-sided vugs 6–22 mm, sharp honeycombed ridges in between, granular ooids, a few broken fossil shell arcs and tiny eroded coral fragments, subtly uneven and geologically organic. Nothing larger than 25 mm. Fine eroded coral limestone, NOT lava, gravel, sand, cracked mud or smooth marble. Irregular shapes and sizes, no uniformly round bubbles. No large cracks, slabs, bedding, blocks or landscape. No dominant feature, no broad gradients, no blank smooth regions. Even statistical coverage across image, isotropic, no up or down. Edge-to-edge material, seamless in X and Y if possible. All detail tack sharp, scientific displacement scan appearance.

## 2. `source/fresh_relief.png`

Use case: photorealistic-natural.
Asset type: raw scalar displacement source for a realistic game limestone material.
One square image filling the frame with the interior of a freshly broken pale fossiliferous oolitic limestone. Orthographic straight-on, edge to edge material, no scene, no object silhouette. The square is 45 cm across. Extremely detailed small fresh conchoidal curved fracture facets and sharp irregular hackly calcite edges, facets mostly 2–12 mm across, densely packed tiny round ooid sections under 2 mm, dispersed broken shell sections, small coral fragments in cross section and two tiny broken gastropod sections 10–18 mm across. A FEW small open pores. Geological natural limestone, NOT marble veins, lava, gravel, polished terrazzo or layered slate. No large crack networks, no smooth patches, no large slabs or any shapes over 25 mm. Random fracture orientations; no overall flow or bands.
GRAYSCALE HEIGHT MAP: brightness encodes elevation only. White is highest, medium grey flat matrix, charcoal deepest pores. No colour, no illumination, no cast shadows, no highlights. Distinct crisply delineated shallow facets, varying heights, white raised fossil fragment edges. No up/down or directional lighting. Even texture distribution with no vignette, gradient or central focal point. Seamless opposite edges if possible. Photoreal geological microstructure, useful as a displacement master, not a beauty render. No text or labels.

## 3. `source/limestone_pigment.png`

Use case: photorealistic-natural.
Asset type: square flat diffuse pigment source for a limestone game material.
A completely flat, evenly coloured, unlit orthographic albedo texture of pale cream-buff oolitic coral limestone. Dense subtle rounded 1 mm ooids and broken whitish shell flecks in a fine granular carbonate matrix. Very softly mottled natural cream, sandy buff, desaturated warm ochre, pale warm grey and cooler grey mineral patches, gently wandering and softly merging, no focal point. Overall average approximately sRGB 196,178,140. Low contrast. The whole image represents 50 cm of rock skin with thousands of grains, no feature larger than 15 mm except soft colour mottling. Colour information only, no structural shadows, no lit edges, no highlights, no directional illumination, no deep dark holes, no gradients across the image. No clouds, veins, cracks, stone slabs, borders, text, perspective, seams, objects or scenery. It must be a physically believable high-resolution stone pigment scan, evenly detailed from edge to edge, isotropic and seamless in both directions.

## Build use

The tool returned 1254 × 1254 for each source. The prompt's nominal field of view was not accepted blindly: the weathered source was reduced to 640 px and the fresh source to 320 px before fragment synthesis, keeping the largest useful source features near the 30 mm skin limit. Brightness in the relief artwork is treated as authored scalar elevation, not measured photogrammetry. No source relief brightness is copied into diffuse colour. The pigment source supplies chromatic variation and filtered mineral mottling. The scripts add physically scaled native-resolution cavities, shell fragments and mineral grain. The crust is derived from the clean material's masks without a separate image generation call.

The round-one refinement added continuous shallow fracture planes, and fifteen 15–25 mm fossil sections cropped from the preserved fresh source. These used the existing source; no further image-generation calls were made. The exact crop boxes and placements are in the build script and build metadata.

## FEEDBACK-1 revision

No new image-generation calls or prompts were used. The three original generated pictures above are reused unchanged. The brief explicitly authorizes building native-resolution detail by script; this revision changes that build so the colour and relief remain registered.

The accepted crust, weathered height, normal and roughness are preserved. Clean weathered pigment now uses pore/depression masks for grey mineral deposits, exposed crests for pale scoured stone, and native 1–3 mm mineral grains with sparse ochre staining. Fresh relief now combines continuous irregular planes with 3,700 short fracture tears specified at 2–8 mm, 6,600 native pores, 640 broken shell arcs and fifteen source-derived fossil sections. Native mineral masks supply colour, height and roughness together. All means still use the brief's explicit targets. `source/srgb.icc` is the original delivery's colour profile, retained to avoid timestamp-dependent PNG changes; it is not a generated image.
