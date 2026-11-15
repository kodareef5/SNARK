# Image generation prompts

Tool: built-in `image_gen.imagegen`. Originals are retained without modification in `source/`. Generated art is source material for the deterministic build; it is not a measured scan.

## P01 — weathered stone pigment

```text
Use case: photorealistic-natural. Asset type: unlit PBR stone pigment source for a survival game. Make a square edge-to-edge orthographic material scan of one continuous massive dark greenstone / ironstone surface, the worn skin of very dense fine-grained hard rock. Field of view is 50 by 50 centimetres. Subtle fine hackly chips 1–12 mm, subdued tiny crystalline mineral grains, a few fine incomplete hairline fissures, broad but very low contrast mineral mottling. Dense smooth worn areas between chips. Palette charcoal grey-green and cool grey-black, average sRGB approximately (74,76,70); small warm grey mineral flecks, no yellow ore, no rust. Natural geology, materially convincing fine irregular jagged texture, NOT porous limestone, gravel, cement or stylized noise. Entire surface is coplanar. Flat cross-polarized diffuse albedo capture with perfectly even ambient illumination: no directional light, no bright edge highlights, no directional bevel shading, no shadow, no vignette, no bright center, no baked specular. Colour contrast restrained; almost all values between 50 and 100. No large rock facets, no boulder silhouette, no wide cracks, no features larger than 3 cm, no repeated pattern, no text, no border. Isotropic structure, no preferred direction. Output one square texture only.
```


## P02 — fresh fracture scalar relief

```text
Use case: scientific-educational. Asset type: grayscale scalar HEIGHT MAP source for a physically based dark hard-rock material. Create one square edge-to-edge dense monochrome topographic displacement texture of freshly fractured massive greenstone or fine-grained ironstone. Field of view 45 by 45 cm. THIS IS A HEIGHT MAP, NOT A LIT PHOTO: brighter means higher and darker means lower. No illumination, no shadows, no highlights, no side lighting. White high and black low. Most surface lies near middle gray. Authentic subtle sub-centimetre conchoidal fracture shells, many tiny angular hackly breaks, short stepped chipped edges, flat smooth solid mineral faces interlocking with irregular boundaries, a little fine crystalline grain. Fractures occur on many scales from 0.5 to 20 millimetres. Geological, dense, hard and massive rather than soft or porous. Small shallow forms only, no large facets or boulder geometry, no deep pits or cracks, no cell grid or cobblestones. Directionless and isotropic fracture orientations, no predominant diagonal. Uniform statistical density across the entire image, no vignette, no center, no grid, no text. Crisp realistic physical scalar relief detail with calm solid flats between the small fractures; quiet mid-gray height field with narrow shallow dark fracture depressions and gently varying polygonal faces. Seamless texture intent; image fully filled.
```

## P03 — sulphide and quartz pigment

```text
Use case: photorealistic-natural. Asset type: unlit PBR base-colour material source for massive brassy sulphide ore filling a rock seam. One square edge-to-edge orthographic texture, field of view 40 by 40 centimetres. Surface is almost entirely solid intergrown massive chalcopyrite and pyrite, with small irregular milky smoky quartz inclusions (about 12 percent) and sparse dull dark umber sulphide tarnish along tiny grain boundaries (about 8 percent). Brass sulphide is warm subdued brass-yellow / pale ochre gold, NOT orange copper or lemon-yellow paint. Quartz is recognizably pale neutral grey to warm grey, not gold. Numerous interlocking small blocky cubic microcrystal faces, random isotropic orientations, crystals only 1–9 millimetres wide, packed into a DENSE HARD ROCK, not loose crystals. Occasional sparse short quartz threads, no large vein path or central stripe. Natural irregular grain-size distribution. Not jewelry, not gold foil, not glitter, not geode, not crystal spikes, no bright pinpricks. FLAT CROSS-POLARIZED DIFFUSE ALBEDO: absolutely no directional lighting, no shadows, no shiny highlights, no bright beveled outlines, no cast shadows, no AO except very faint grain interstices, no gloss baked into color. Metal reflectivity will be added later using separate normal, metalness and roughness maps. Entire image filled with the same ore material at constant scale. No surrounding dark host rock, no boulder, no border, no text, no vignette. Restrained local contrast, realistic mineral identity and structure, fine detailed grain, seamless texture intent.
```

## P04 — blocky ore scalar relief refinement

```text
Use case: scientific-educational. Asset type: SCALAR HEIGHT MAP for massive brassy sulphide ore; not a photograph. Produce one square grayscale texture. White means higher, black means deeper, mid-gray is the mean surface elevation. A dense intergrowth of small blocky pyrite and chalcopyrite grains, as seen looking straight down onto a freshly broken massive sulphide seam. Field of view 30 cm square. Angular polygonal cleavage faces 2–8 millimetres wide, some squarish, a few rectangular striations in individual grains, multiple intersecting small planar faces. Grains are fused into one solid mass: not gravel, not loose crystals, not isolated cubes, not a geode. Crisp flat planes with subtly differing constant grayscale values and small gentle planar ramps; irregular sharp short grain boundaries. Restrained shallow depth, no large raised forms. All orientations distributed evenly. DO NOT draw light or reflection: no black cast shadows, no white specular highlights, no shiny outline or glare, no global gradient. Avoid rounded lumps, wrinkled foil, pitted limestone, cloudy noise, sand, star-like glitter, long cracks, broad seams, text, border. The output is technical height data rendered as grayscale, not a lit beauty render. Dense natural interlocking hard mineral microstructure throughout, seamless texture intent.
```


# Round two — FEEDBACK-1

Native code rebuilds relief and all aligned material channels; the built-in image tool supplies the following new source artwork. Prior source images are retained unchanged.

## P05 — hard fracture height artwork

Use case: game-texture source artwork. Asset type: square scalar height field for the fine skin of hard dark greenstone, NOT a shaded photograph. Entire image is tightly packed natural hackly fracture facets, representing a 30 cm square freshly broken stone surface. Millimetre to two-centimetre angular fracture flakes and chips, interlocking irregular planar faces with abrupt sharp stepped edges, occasional curved conchoidal ripples within faces and rare very fine hairline fissures. A dense massive stone, not porous, not gravel, no isolated pebbles. Each face has a near-uniform medium-grey elevation and subtle linear planar slope, neighbouring faces differing in grey height. Grayscale only, medium-grey overall, black means low and white means high. Crisp geometric fracture information, no directional illumination, no bright edge highlights, no cast shadows, no AO, no perspective, no vignette, no text, no border. Non-directional statistically even coverage. Avoid fuzzy noise, plaster, fabric, sponge, rounded hills and stylized tessellations; keep the broken faces irregular and geologically natural. This is raw displacement artwork; colour and lighting will be computed separately.

Saved unchanged as `source/P05_hackly_height.png`.

## P06 — packed sulphide crystal pigment

Use case: game-texture material-source artwork. Asset type: square seamless top-down unlit albedo texture of dense massive brassy sulphide ore, an extreme close-up covering 15 centimetres across. Fully fill frame with tightly intergrown angular and CUBIC pyrite/chalcopyrite grains, 2 to 15 mm each. Strongly faceted packed interlocking crystal blocks, straight square and rhombic edges, individually discernible flat faces with independent brass tones. Compact crystalline material, no rounded bubbles, no sponge, no hammered metal, no glitter. Mostly restrained tarnished ochre brass with occasional richer bronze and very sparse dark purple-blue tarnish. Thin brown-black tarnish on selected crystal grain boundaries. Sparse angular wedges of opaque milky grey quartz between the sulphide blocks, 8 to 12 percent coverage. NO lighting in this map: cross-polarized diffuse-scanned albedo appearance, all planar faces evenly lit, no reflections, no sun glints, no specular highlights, no bevel lighting, no cast shadow, no overall gradient. Every brightness change should be an intrinsic mineral colour, not shading. Random grain orientations, no rows or grid. Dense straight-edged crystalline geological realism suitable for a material library. No outer specimen outline, no background, no labels, no border.

Saved unchanged as `source/P06_crystal_pigment.png`.
