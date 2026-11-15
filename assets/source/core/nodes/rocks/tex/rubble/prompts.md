# Rubble material source prompts

Built-in imagegen. Every output is archived without resizing in `source/`.
All six requests generate new material source artwork. The supplied concept art
and NOTES.md were inspected for palette and surface character; no image was
submitted as an edit target. Procedural derivation and later corrections are
documented in REPORT.md and the build script.

## P01 — broken

```text
Use case: photorealistic-natural. Asset type: physically based game material source, square orthographic diffuse ALBEDO texture, edge-to-edge surface only. This is a material skin for ruined subtropical city rubble. Flat and unlit: remove all directional lighting, highlights, cast shadows, ambient gradients and vignette; only very faint occlusion inside pores. Seamlessly tileable in both axes, isotropic, no dominant direction. Natural irregular detail, no repeated stamps, no large landmark patch, no text, no border, no perspective, no objects or model geometry. The represented field is 1.5 metres square. Show plentiful sub-centimetre and millimetre detail; no chips or cavities larger than 3 cm.

Subject: Old fractured structural concrete. Dense hackly cement fracture with numerous embedded irregular angular pale limestone aggregate sections, mostly 4–22 mm across, a few dull charcoal stones, and small irregular pinholes. Grey warm cement body sRGB (154,151,139); pale gravel (191,181,158). Aggregate distributed throughout about 40 percent of area, not loose pebbles. Sharp crumbs of mortar around exposed grains, heterogeneous packed crushed grit, microfractures. It must read as a snapped concrete interior, not polished terrazzo, cobblestones, gravel lying on top, cracked mud, or a pile. No slab edges or rebar.
```

## P02 — cast

```text
Use case: photorealistic-natural. Asset type: physically based game material source, square orthographic diffuse ALBEDO texture, edge-to-edge surface only. This is a material skin for ruined subtropical city rubble. Flat and unlit: remove all directional lighting, highlights, cast shadows, ambient gradients and vignette; only very faint occlusion inside pores. Seamlessly tileable in both axes, isotropic, no dominant direction. Natural irregular detail, no repeated stamps, no large landmark patch, no text, no border, no perspective, no objects or model geometry. The represented field is 1.5 metres square. Show plentiful sub-centimetre and millimetre detail; no chips or cavities larger than 3 cm.

Subject: Weathered cast concrete face, still mostly smooth continuous cement, neutral warm grey sRGB (154,151,139). Tiny scattered irregular air pinholes 1–7 mm, occasional 12 mm pore, gritty cement paste, subtle mottled rain-leached minerals, short faint worn form-contact impressions in varied orientations, a few very fine discontinuous branching hairline cracks. Preserve broad quiet paste between pores. No regular board seams, no long stripes, no rusty stains, no exposed coarse aggregate, no slab perimeter.
```

## P03 — stucco

```text
Use case: photorealistic-natural. Asset type: physically based game material source, square orthographic diffuse ALBEDO texture, edge-to-edge surface only. This is a material skin for ruined subtropical city rubble. Flat and unlit: remove all directional lighting, highlights, cast shadows, ambient gradients and vignette; only very faint occlusion inside pores. Seamlessly tileable in both axes, isotropic, no dominant direction. Natural irregular detail, no repeated stamps, no large landmark patch, no text, no border, no perspective, no objects or model geometry. The represented field is 1.5 metres square. Show plentiful sub-centimetre and millimetre detail; no chips or cavities larger than 3 cm.

Subject: Old chalky salmon-pink paint over pale cream lime-cement stucco. Paint pigment sRGB (202,148,137), bare render (221,209,183). About 72 percent paint remains in irregular contiguous areas with many small ragged-edged missing paint flakes, clustered peel loss spread evenly throughout the field, mostly 2–8 cm patches with occasional 12 cm connected patch. Underneath is intact fine sandy pale render, not holes. Paint only a fraction of a millimetre thick. Fine crazing, chalk bloom, restrained dusty local variation. No curling thick flakes, no shadows under paint, no large wall geometry, no brick, no separate paint colours. Preserve a clearly separable pink-vs-cream material boundary.
```

## P04 — coral

```text
Use case: photorealistic-natural. Asset type: physically based game material source, square orthographic diffuse ALBEDO texture, edge-to-edge surface only. This is a material skin for ruined subtropical city rubble. Flat and unlit: remove all directional lighting, highlights, cast shadows, ambient gradients and vignette; only very faint occlusion inside pores. Seamlessly tileable in both axes, isotropic, no dominant direction. Natural irregular detail, no repeated stamps, no large landmark patch, no text, no border, no perspective, no objects or model geometry. The represented field is 1.5 metres square. Show plentiful sub-centimetre and millimetre detail; no chips or cavities larger than 3 cm.

Subject: Sawn coral limestone building stone, a continuous flat cut face. Pale cream-buff body sRGB (209,192,160), chalk-white shell sections and small irregular ochre-tan pore interiors. Dense bioclastic grains, fragments of broken bivalve shells cut at random oblique angles, short thin sinuous shell cross-sections, sparse irregular fossil coral head fragments with tiny honeycomb pores, all embedded flush in stone. Fossils mostly fragmentary 3–20 mm, never complete seashell icons or starfish. Dissolution holes 2–18 mm with irregular lobed outlines, quiet areas between clusters. Weathering has erased saw grooves. No loose shells, no beach, no rock outline, no giant honeycomb sponge.
```

## P05 — block

```text
Use case: photorealistic-natural. Asset type: physically based game material source, square orthographic diffuse ALBEDO texture, edge-to-edge surface only. This is a material skin for ruined subtropical city rubble. Flat and unlit: remove all directional lighting, highlights, cast shadows, ambient gradients and vignette; only very faint occlusion inside pores. Seamlessly tileable in both axes, isotropic, no dominant direction. Natural irregular detail, no repeated stamps, no large landmark patch, no text, no border, no perspective, no objects or model geometry. The represented field is 1.5 metres square. Show plentiful sub-centimetre and millimetre detail; no chips or cavities larger than 3 cm.

Subject: The fine grey gritty face of an old concrete cinder block, a continuous material closeup without the block's shape. Warm grey sRGB (150,148,137), slightly darker than poured concrete. Dry-cast open texture: packed small sand and crushed cement grains mostly 0.5–4 mm, fine dark cinder specks, irregular intergranular small voids and occasional 3–8 mm pinholes. Subtle compacted areas and denser paste amid coarser patches. Read as manufactured grey cement, not granite, asphalt, natural stone, fuzzy noise, large gravel, or a field of circular holes. No rectangular block cavities, joints, edges or mortar.
```

## P06 — rust

```text
Use case: photorealistic-natural. Asset type: physically based game material source, square orthographic diffuse ALBEDO texture, edge-to-edge surface only. This is a material skin for ruined subtropical city rubble. Flat and unlit: remove all directional lighting, highlights, cast shadows, ambient gradients and vignette; only very faint occlusion inside pores. Seamlessly tileable in both axes, isotropic, no dominant direction. Natural irregular detail, no repeated stamps, no large landmark patch, no text, no border, no perspective, no objects or model geometry. The represented field is 1.5 metres square. Show plentiful sub-centimetre and millimetre detail; no chips or cavities larger than 3 cm.

Subject: The rust skin of old corroded reinforcing steel, sampled as a flat material sheet; the represented field is 0.25 metres square, overriding the common 1.5 metre scale. Deep dark corroded iron sRGB (84,49,31), with irregular fractured thin oxide platelets in burnt orange-brown (149,83,38), locally dull near-black brown pits. Tiny 0.5–4 mm flakes with chipped scalloped margins, orange oxidation concentrated along some platelet margins and thin patches, dense granular ferric crust. Dark body occupies most area, scattered orange patches about 25 percent, no broad bright orange region. Fine surface relief suitable for a 2 cm rod. No rod, no ribs, no bolts, no directional streaks, no metallic glints.
```
# Round two — FEEDBACK-1.md

Built-in imagegen, five new independent sources. No image references submitted; concept art was inspected before writing these prompts. Exact prompts:

## P07 broken

Use case: photorealistic-natural. Asset: square seamless physically based material SOURCE for the snapped interior of old reinforced concrete, orthographic surface filling the entire frame. The image covers 90 cm of fracture. Show many distinctly protruding angular and partly rounded limestone pebbles 5 to 25 mm diameter in crumbly grey cement, sparse dark grey aggregate, deep plucked-out pebble sockets and hackly matrix with sand grains. This is a freshly broken edge of old concrete, NOT a sawn or polished terrazzo face. Coarse pebbles must read as individually rounded fractured solids embedded in brittle cement. Material colors: grey cement RGB 154 151 139; pale limestone RGB 191 181 158; darker grey gravel. Capture intrinsic pigments under extremely diffuse shadowless cross-polarized illumination, minimal cavity occlusion, absolutely no directional bright rims, directional shadows, glossy highlights, perspective, objects, seams, borders, labels or text. Uniform overall exposure, no vignette. The image must retain strong material separation and detailed natural fracture, not smooth low contrast noise. Equal sharpness everywhere. Seamless edges.

## P08 cast

Use case: photorealistic-natural. Square seamless albedo material texture, orthographic close view of weathered cast concrete in an abandoned subtropical city, covers 90 cm. Entire image is the same continuous cast surface. Clearly visible irregular age: clustered bug holes 1 to 8 mm, tiny exposed sand grains, faint interrupted form-board impressions, thin branching hairline crazing, scattered worn-through patches showing pale fine aggregate. Uneven black-grey rain grime, several muted rust-brown runoff traces, sparse grey-green algae stains with ragged boundaries. Large quiet grey paste regions between weathered regions. Mid-grey warm cement RGB 154 151 139 average, retain visibly contrasting stains without making the whole surface dark. Fine matte material detail, realistic aged construction material, not a uniform grey noise sheet. Perfectly flat intrinsic albedo, uniform diffuse cross-polarized illumination without directional shadow, highlight, vignette, perspective, visible wall edges, large cracks, bolts, text or borders. Seamless all edges.

## P09 stucco

Use case: photorealistic-natural. Square seamless material source, orthographic close view of OLD CHALKY PINK PAINT ON CREAM STUCCO RENDER covering 90 cm. Uneven weathering with broad contiguous regions of intact faded salmon-pink paint, and broad connected regions where most paint has peeled to granular cream render, linked by irregular eroded bands and fine branching cracks. About 60 percent paint and 40 percent bare render. Do NOT distribute little chips evenly as camouflage. Individual surviving paint islands and peeled edges should be jagged and thin, with modest lifted curling edges. Whole paint is thick chalky matte, faintly streaky and dirty. Visible fine sand stipple, trowel swirls and hairline crazing in cream substrate. Three or four longer fine plaster cracks collect flakes. Pink RGB 202 148 137, render RGB 221 209 183. Very high material detail, realistic painted mineral render. Flat albedo source with uniform shadowless diffuse illumination, no lighting gradient, specular, cast shadows, wall boundaries, perspective, text or objects. Fill frame, seamless edges.

## P10 coral

Use case: photorealistic-natural. Square seamless material source of a SAWN CORAL LIMESTONE construction block, orthographic macro view covers 90 cm across. Unmistakable fossil coral rock, not concrete, generic limestone or tiny uniform speckle. In the flat sawn face show many irregular fragmented sections through coral colonies at natural scale: clusters of small ring and cup polyp cross-sections with radial septa, patches of sinuous brain-coral grooves, oblique broken laminated shell arcs, narrow winding worm tubes. These are embedded cut sections FLUSH with the stone, not intact shells or coral resting on top. Scattered irregular open dissolution cavities 3 to 30 mm with muted brown mineral fillings; pale cream to warm buff body RGB 209 192 160. Coral colonies span 3 to 12 cm and are irregularly fragmented, never regular isolated decorative circular medallions. Some quieter areas of micritic limestone. Strong enough fossil definition to recognize at two metres. Intrinsic albedo in perfectly uniform diffuse shadowless cross-polarized light, almost no ambient occlusion, no directional shadows or highlights. No surrounding object, block edges, perspective, grid, labels or text. Seamless edges.

## P11 block

Use case: photorealistic-natural. Square seamless material albedo source, orthographic close surface of an old dry-cast hollow cinder block. Only the continuous gritty material skin, no shape of block, hollow cells, joints or edges. Image covers 90 cm. Coarse openly packed cement sand and small dark charcoal cinder grains plus pale angular mineral grains 1 to 6 mm, many irregular intergranular voids 1 to 5 mm, sparse small shallow chipped pockets exposing gritty cement. Uneven faint dark grime and mottling. Grey cement RGB 154 151 139, clearly distinguish dark and light grain populations and porous texture without turning into large aggregate concrete. Tactile, open, friable, dry matte, NOT a smooth grey sheet and NOT a polished speckled surface. Flat intrinsic color under extremely diffuse cross-polarized illumination with no directional light, highlights, dark shadows, vignette or gradient. Entire frame sharp. No text or border. Seamless edges.
# P12 bare render — round two refinement

Use case: photorealistic-natural. Square seamless material source, orthographic face-on close photograph of bare old lime-cement stucco render, no paint. Frame covers 90 cm. Pale cream render RGB 221 209 183, unmistakeably mineral plaster: tactile sand-grain stipple, overlapping shallow curved trowel strokes and short combed swirls, worn peaks, tiny pinholes, occasional fine crazing. Quiet broad regions and subtle variations in application. The marks are minute surface relief not graphic stripes or big grooves. Real dry matte granular render, not a featureless cream sheet or generic cloudy noise. Uniform shadowless cross-polarized illumination, intrinsic colors with only faint darkening in pinholes, no directional shadows, no directional bright rims, no highlights, no exposure ramp. No surrounding wall edge, perspective, masonry joint, chips larger than 2 cm, text, objects or borders. Seamless all edges, equally sharp everywhere.

