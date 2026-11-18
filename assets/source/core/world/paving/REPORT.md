# Precast concrete paving

Sixteen 500 mm flagstones cover a 2 m square. The outer edges bisect the sand joints. Each casting has a slightly different warmth and value. The base averages sRGB **(130, 126, 120)**. Along the straight runs, the median joint width is **9.2 mm**, interpolated at 50% concrete coverage. Small chips widen the mouth locally.

## Material files

All six maps share a 2048 × 2048 grid. One texel spans 0.977 mm. Five generated overhead concrete studies and a separate joint-sand study supplied the colour. Downsampled crops were rotated and joined across irregular, feathered boundaries on a wrapping canvas. A seventh study of a joint intersection served as an edge reference.

| File | Construction and checks |
| --- | --- |
| [base.png](base.png) | The photographic crops retain cement skin, partially exposed mineral fragments and sand between larger grit. Broad exposure drift was removed before quilting. Each casting received a small pigment adjustment. A narrow deposit of dark fines follows its arrises. The RGB8 file carries an sRGB tag. Solid concrete averages (131, 127, 121) and exposed fill averages (109, 101, 92). |
| [height.png](height.png) | Connected mineral outlines were separated from the binder. Distance inside each outline sets the crown profile, with independently assigned embedment for light and dark stones. Cement wear, pores, two hairlines, rounded bevels, six chipped corners and occasional nicks supply the rest of the face geometry. Sand and grit sit on a separate uneven bed. The 16-bit greyscale spans 0–65535. Median concrete height is 17.85 mm and median fill height is 12.19 mm on the 20 mm scale. |
| [normal.png](normal.png) | Wrapped central differences of the delivered height use the physical texel spacing. The unit normals are encoded as RGB8 with green pointing up the image. An independent calculation from the saved PNG matched every channel at every pixel. |
| [roughness.png](roughness.png) | Exposed mineral faces are slightly smoother than the cement. Abrasion, pores and sand packing vary the response locally. Median linear values are 0.855 on concrete and 0.953 in the joints. |
| [occlusion.png](occlusion.png) | Sixteen horizon directions sample the local relief out to 26 mm. Opposite directions are paired so that a uniform slope stays open. The median is 253 on concrete and 192 in the fill. Dark pockets follow the grain gaps, pores and chipped arrises. |
| [tint.png](tint.png) | The casting outline supplies coverage, including bevels and chipped edges. Slab interiors are 255 and exposed fill is 0. Intermediate values occupy 0.79% of the tile, along the material boundary. |
| [material.json](material.json) | Records the 2 m width, 20 mm height span, rounded mean of the saved base and module of [0.25, 0.25]. A 512-pixel shift on either axis moves one joint centreline onto the next. Concrete and sand are both dielectric. |

## Inspection

| Picture | What I checked and saw |
| --- | --- |
| [Half-tile offset](checks/offset.png) | Base, height and roughness wrap by 1024 pixels in both axes. The sand texture passes through the central crossing with comparable density and depth on all four approaches. |
| [Native 3 × 3 repeat](checks/tiled3.png) | The top panel is base colour and the bottom is height. Both preserve all source texels. Individual castings are distinguishable, especially along a shared edge. I could not track the tile boundary by a particular chip or patch of grit. |
| [12 × 12 repeat](checks/tiled12.png) and [40 × 40 repeat](checks/tiled40.png) | Each 2048-pixel sheet averages the full corresponding footprint in linear light. I redistributed slab pigment after an early sheet showed a horizontal band. In the final fields, mild slab-to-slab differences persist while the aggregate resolves to a continuous tone. |
| [Relighting](checks/relit.png) | The same colour and height receive two opposing 15° suns and a 70° sun. At the junction in the native crop, the bright bevel moves to the opposite lip when the low sun reverses. Pale sand fragments remain pale in all three views. |
| [Aligned layers](checks/layers.png) | All six panels use the same 300-pixel crop. The clipped corner in the lower right of the junction has the same footprint in the tint, fill, roughness and geometry. The surrounding deposit appears in base colour without a trench in height. |
| [Photograph comparison](checks/photo-comparison.png) | The left crop is at native resolution. The right crop covers the same 47.7 × 31.1 cm of photographed precast concrete. The upper pair shows original base colours. The lower pair uses the same diffuse light and each material’s own normals. [Comparison scan (CC0)](https://polyhaven.com/a/concrete_pavement) |

## Remaining limitations

The photographic reference has warmer cement, fewer exposed pale grains and tighter joints. It samples 1.76 mm per texel, so the comparison is strongest for aggregate distribution and edge wear. The finish resolves finer sand. Wet specular response and motion during camera travel remain unverified in the game.

## Round two

Replaced the procedural face colour with photographic quilts and widened the joints from 6.8 to 9.2 mm. Pale sand now interrupts the dark grit, and the fill sits a median 5.7 mm below the concrete. The new edge geometry includes chipped arrises and wider worn bevels. Across the sixteen slab interiors the mean luma range increased from 1.4 to 6.4 sRGB code values. The 500 mm pitch and palette target are unchanged.

<details>
<summary>Photographic source prompts · built-in ImageGen</summary>

**Exposed limestone**

> Square orthographic material survey photograph looking straight down at one uninterrupted 90 by 90 centimetre area of old, fine exposed-aggregate precast sidewalk concrete from coastal Florida. Fill every pixel with the pavement face, cropping out all seams and edges. Real sand-cement binder with a subtly ragged wash, densely embedded little fractured dull oyster-grey limestone, neutral quartz sand, pinhead charcoal and buff mineral flecks. The ordinary mottled clusters of worn cement skin and partly exposed fine mineral chips in real sidewalk concrete; angular grains mostly 1 to 5 mm across with only scant 6 to 8 mm, irregular packing and exposure. A weathered unsealed matt surface viewed in diffuse white overcast light, cross-polarized albedo scan, dry. Naturalistic local colour and mineral detail like a sharp land survey photograph, uniform focus edge to edge. Medium pale neutral warm grey, same average colour and exposure throughout the image. No shadow direction, joints, cracks, stains, large patches, shell shapes, text, reflections, debris, rulers, borders, vignette or decorative terrazzo.

**Weathered paste**

> A square, true top-down photographic sample of the uninterrupted face of a weatherworn precast sidewalk flagstone, showing 0.9 metres across. Full bleed: one flat sheet of concrete face, without edges or joints. Ordinary Miami fine-aggregate architectural concrete, weathered just enough to expose tiny angular grains of cream limestone, salt-and-pepper silica, charcoal grains and quiet sandy ochre through greige cement paste. Many mineral particles about 1–4 mm and occasional chips to 7 mm, aggregate locally distributed in irregular small pockets of dissolution and tiny pinholes, some areas still have cement skin. Real material under flat soft white overcast cross-polarised illumination. Faithful high spatial frequencies, no dramatic contrast. No directional shadow, large blotches, grid, cracks, large gravel, strong veins, leaves, borders, rendered noise, text, highlights or perspective. A photographic reference for making an albedo material map, sharp all over, constant average tone from side to side.

**Fine grey aggregate**

> Square overhead orthographic material capture of 1 metre across the uninterrupted face of worn, unsealed, ordinary precast sidewalk concrete in Miami. Fill the entire frame with medium neutral stone-grey cement binder and fine exposed aggregate: soft little cream limestone fractures, dark neutral quartz grains, grey translucent mineral chips. Most grains between 1 and 5 mm, occasional 6 mm. Retain a good deal of slightly uneven cement skin with little abraded patches revealing denser scatter; real photographic grain edges fading into binder. Dry, evenly lit by full overcast white sky, matt with no shadows or specular bright rims. Sharp across the entire image at native resolution. Constant average tone across the field. No slab edges, dividers, joints, text, weeds, stains, pronounced cracks, loose pebbles, large white spots, veins or patterns. High quality flat albedo reference.

**Pitted cement skin**

> Photograph a 1 m wide square of the interior of a sun- and rain-worn grey architectural precast concrete flagstone, camera dead overhead, the real pavement face filling the frame. This is lightly exposed-aggregate pedestrian concrete with a quiet small-scale peppery mineral texture, broken ivory and dark siliceous grains of a few millimetres partly embedded and flush in muted grey-beige cement, fine sand in the matrix, shallow pinholes. Thin irregular areas retain more of the original cement skin, cross-polarised white overcast daylight. The picture must look like a sharp material sample for a real building survey and be evenly illuminated. No included edges or seams, no stain, clear crack, broad swirls, large-scale gradation, coloured debris, dramatic shadows, text, or scale marker. Ordinary, naturalistic material, no decorative terrazzo.

**Binder-rich face**

> A square, edge-to-edge, rectified top-down digital photograph of ONE METRE across an uninterrupted, weather-aged precast sidewalk face. The material is grey Portland cement with a fine salt-and-pepper complexion. Crucial: about three quarters of the visible surface is continuous weathered cement paste, with fine pores and sand; it is possible to see the binder between the individual hard mineral inclusions. Fairly sparse partly embedded angular grains, mostly small dark grey basalt, dull quartz and soft buff limestone with only occasional pale flecks, distinct little angular shapes a few millimetres across, never bright white. Subtle natural shifts at 5 to 20 mm scales in the thin veil of cement skin. Real matt concrete in neutral flat overcast light, cross-polarized. Slightly warm mid grey. Everything is sharply in focus. Use real surveying photography, absolutely no artificial stippling or gravel bed, terrazzo, line, joint, crack, debris, dark corner, vignette, lettering, border or arrow. No directional shadows. Square.

**Joint sand**

> Square orthographic field photograph of an even bed of weathered sidewalk joint sand, camera perfectly perpendicular. Show a roughly 38 centimetres square patch filling the frame, exclusively very fine light buff and cool grey quartz sand with many darker charcoal/brown angular grit fragments from 1 to 4 millimetres. Irregular small pockets of different grain sizes, tiny pale sand bridges interlocked between dark particles, tamped flat by rain, no wet shine. Everything sharp, dry matte, neutral broad diffuse white overcast light, almost shadowless documentation for a photogrammetry colour map. Absolutely no pavement edge, slab, joint line, ruler, labels, vegetation, shell, debris, large stone, stain or directional lighting. Restrained sandy grey-brown colour, uniformly scattered tiny grains to all borders.

**Edge reference**

> Close square reference photograph of real weathered unsealed South Florida sidewalk paving. Field of view 46 centimetres wide, camera exactly perpendicular. Show the intersection of four 50 cm square, fine exposed-aggregate weathered grey concrete flags, cropped to four partial slab corners. An orthogonal cross of well-filled 9 MILLIMETRE wide joints slightly left of center, the grey sandy grit lies unevenly 4–6 mm below the slab faces, with fine light sand resting between charcoal grit. Subtly rounded and worn small bevels, tiny chipped edges on one or two corners, very faint dark deposition of fines beside the joint. Face aggregate sand grains and little 1–5 mm light and dark mineral fragments in smooth aged cement. Slightly different warmth and tone on the slabs. Real maintenance survey photograph in soft flat bright overcast daylight, no directional shadows, no wetness, stamp, vegetation, labels, or perspective. Square-on straight grid. Full resolution documentary photograph.

</details>

## Round three

Halved the range of mean slab-interior brightness from 6.36 to 3.18 sRGB levels. I also halved the warm–cool spread and set the sixteen slab means to the same near-neutral red–green value. In the 3 × 3 repeat, slight differences remain visible across shared edges, and the pink and blue-grey outliers have disappeared. The tile keeps its exact round-two RGB mean. Every exposed joint pixel, the five other maps and the material metadata match round two exactly.
