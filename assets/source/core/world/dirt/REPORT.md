# Dirt · compacted Miami fill

One 2048 × 2048 tile covers 2 × 2 m. A texel spans 0.9766 mm. At that scale the chalky faces of half-buried limestone chips are visible among the sandy fines. At street distance the chips merge into a muted tan-brown.

## Round two

I replaced the brown pigment field with full-colour photographic crops from five independent generated ground plates. Up close, compact grey silt gives way to cocoa-coloured crumbs, chalk and rusty grit. Separate photographic cutouts supply the coarser mineral chips, torn leaf scraps and root hairs. In the 625 mm comparison crop, the real dry-earth scan has larger clods. The revised finish shows similar variation among the fines while keeping the vacant lot even at street distance. [Flat and low-sun comparison](checks/closeup.png)

## Material maps

| File | Construction and checks |
| --- | --- |
| `base.png` | I fitted 64 rotated and reflected photographic swatches to irregular regions that wrap around the tile. I reduced each swatch from source resolution before assembly, matched broad colour through the joins and retained the RGB differences inside each swatch. An additional 93 chip specimens supplied mottled mineral faces. The 8-bit RGB export carries an sRGB tag. Its measured mean rounds to **(128, 102, 77)**. |
| `height.png` | The first pass supplies the packed bed and faint crust fissures. I interpolated the soil under the old inclusions. Connected mineral and crumb outlines in the new quilt determine their footprints. Width, distance to the edge, facet orientation and burial depth give each chip a crown and each crumb a rounded shoulder. Thin pieces follow the bed under them. The 16-bit export spans 0–65,535 over 12 mm. Median elevation is 3.65 mm above black. |
| `normal.png` | I took wrapped central differences of the saved height in millimetres at the actual texel spacing. For derivatives along increasing column and row, the OpenGL normal is the normalized vector `(−dH/dx, +dH/drow, 1)`. An independent readback reproduced every RGB byte. |
| `roughness.png` | The previous crust and silt roughness carries through the substrate. Chips, crumbs and litter receive roughness from their individual footprints. Loose crumbs read rougher than the exposed mineral faces. Linear values range from 230 to 255, with a median of 244. |
| `occlusion.png` | I sampled the local horizon of the revised height along eight directions out to 11 mm. Local slope and concavity restrict the darkening to recesses between crumbs and around chip sockets. 55% of the map is fully open. |
| `tint.png` | Soil and crumbs receive 255, exposed mineral interiors 0, and dry leaves and root fibres 60. Fine grit, embedded edges and thin plant fibres take intermediate values according to coverage. The same silhouettes control relief, roughness and tint. |
| `material.json` | Records the 2 m width, 12 mm relief and rounded mean from the finished base. The natural scatter uses a null module. All constituents are dielectric. |

## Visual checks

| Sheet | What I inspected |
| --- | --- |
| [Half-tile offsets](checks/offset.png) | Base, height and roughness run left to right, each shifted 1024 px on both axes. Grain density continues through the four original corners where they meet. Across the two wraps, the average base-colour step was 1.02× the typical horizontal step and 0.97× the typical vertical step. |
| [Three-by-three repeats](checks/tiled3.png) | The upper square contains nine native-size bases and the lower square nine native-size heights. Individual chips are legible at full size. At overview scale, the denser collections of grains merge into the soil without marking a tile boundary. |
| [Twelve-by-twelve repeats](checks/tiled12.png) | I area-averaged 24 m of ground in linear light to 2048 px. The fine grit merges into a continuous tan-brown field. I also inspected 80 m at 1024 px for rows, diagonal bands and bright flecks. [Forty-by-forty field](checks/tiled40.png) |
| [Relighting](checks/relit.png) | Each column uses linear base colour multiplied by diffuse sky fill and a directional sun. The two 15° suns are 180° apart. The third is at 70°. The bright edge switches sides on the same chips under the low suns. The high sun leaves the mineral colour easier to see. The lower row shows the same 625 mm crop in each column. |
| [Registered layers](checks/layers.png) | All six panels show the same 312.5 mm square at native resolution. Chalk and rust-coloured grains have corresponding crowns and tint exclusions. The roughness and occlusion follow the grain edges. |

## Limits

The reference scan has coarser clods and a more uneven spread of gravel than this compacted fill. A few of the smallest leaf scraps still read as brown crumbs under overhead light. I checked diffuse response offline. Wet sheen and palette tint in the game remain untested. The side-by-side sheet uses a 625 mm crop from the scan, shown at the game’s texel spacing and lit with the same sun. The external scan was used only for comparison.

<details>
<summary>Round one source prompt</summary>

> Use case: photorealistic-natural. Generate a square material artist's pigment sample for a game ground texture. A straight-down orthographic, full-bleed scan of the quiet fine earth between pebbles on a compacted subtropical vacant lot of weathered limestone fill. Field of view about 45 cm. Dry-to-damp greyish umber powder and sandy loam, densely interlocking neutral buff silt, darker tobacco-brown tiny clay aggregates, a little warm chalk dust incorporated in it. Extremely ordinary, tactile, close-grained: minute irregular mineral flecks and islands of fine smooth dust in crumb structure, very restrained small tonal variation, dull muted medium brown. Broad perfectly even hemispherical illumination like a cross-polarized diffuse albedo capture. No embedded shadows or lighting gradients. Same material and density right up to every edge. Mid-tone only, fine organic stochastic detail in sharp focus to the pixel. No prominent rocks, discrete leaves, branching cracks, twigs, gravel piles, footprints, large mounds, holes, wet glints, framing, ground plane perspective, labels, letters, collage, diagrams or other items. One continuous soil field.

</details>

<details>
<summary>Round two prompts for the built-in image generator</summary>

**Three mineral-rich soil plates**

> Photorealistic-natural. A square top-down field photograph for a photogrammetry material scan. Fill the frame entirely with ordinary bare compacted earth in an abandoned south Florida yard made of sandy limestone fill. About 75 cm of ground spans the photograph. Camera perpendicular, all grains sharply resolved edge to edge. Flat bright overcast daylight under a diffusion tent, no visible directional light or sheen. It must look like a very real patch of outdoor dirt, with the full natural colour separation and microscopic irregularity of an actual raw photograph. Warm muted medium grey-brown earth overall. Distinct charcoal-brown, cocoa and taupe soil crumbs scattered between buff-grey silt and millimetre-sized sandy grit, occasional cream chalk, slate-grey and muted rusty ochre chips flush in the earth. Tiny short faded root filaments and torn dry leaf flakes around 5–12 mm, never intact leaves. Distributed at random in a continuous quiet surface. There is no central object, no border, no scale marker, no writing. No trails, big stones, wet areas, strong shadows, large plant parts, or dramatic fissures. Preserve the intricate chunky structures and irregular mineral colour of real soil under diffuse light.

1. Sandy loam with fine cocoa-coloured aggregates and paler dust gathered in their interstices. Some areas are shallowly crusted. Small irregular grit flecks grow noticeably more numerous close up, but it is soil, not a gravel bed. Weathered stones are roughed up, dusted and embedded.

2. A second independent sample of the same ordinary soil. This patch has plenty of intimately mixed grey-brown clods, fawn earth, ochre sand and dusty charcoal grains; tiny granular islands and compacted silt, with scattered limestone chips and small rust-coloured grains. Very fine dried skin on the silt, a few short hairline nicks. Texture density uniform to the edges.

3. A third independent sample. This patch shows finely crumbled greyish earth with compacted cinnamon-brown silt and partly lodged calcareous granules, a few tiny dry plant splinters among the crumbs. Subtle coherent groups of coarse and fine material are characteristic of soil. Small dust-muted cream, grey and tan limestone nibs pepper the surface.

**Two finer soil plates**

> Photorealistic-natural. Full frame, square, top down cross-polarized field photograph of a 1.15 metre square of compact sandy fill, a bare-earth path in an abandoned Florida yard. No horizon. True orthomosaic detail. Fully diffuse overcast sky, no directional cast shadows or speculars. Sharply focused. Sun-aged, quiet medium earth brown. Countless irregular textures of a real natural soil photograph: visibly distinct dark grey-brown, cocoa, taupe and rusty brown millimetre-scale crumbs, fine buff-grey sand and smooth thin areas of dry silt, dusty organic flecks. The subject is the rich multicoloured dirt itself. Only very little gravel and very little plant matter, all smaller than a fingernail, scattered tiny dull grey grit, reddish quartz and cream limestone. No large stones, no clumps of roots or long cracks, no distinct single subject, no footprints. No stylization, no larger landscape, no labels, no borders. Make every cm full of true photographic soil colour and structures, entirely even coverage across the image. 

1. A denser rain-sealed surface with tiny broken crust edges, drops of chalky silt and dark, barely perceptible bands of fines worked between the irregular earth crumbs. There are some pinhead gravel chips embedded in the thin dried skin. The mix is visually balanced and ordinary. The shot covers a broad patch of ground.

2. A field of fine, slightly looser, weathered soil crumbs in soft brown-grey, dull chestnut and coffee colours intimately mixed with superfine grains of sand, microscopic broken plant matter and intermittent compacted silt. Short, extremely fine faded straw root flecks. Indistinct tiny chips of mineral. A uniform distance photograph with fine microstructure right to every edge.

**Botanical specimens**

> Photorealistic-natural. Macro reference photograph for a natural history materials library. Square frame straight overhead. About forty different tiny dry plant debris pieces lying well apart on a perfectly flat, solid cyan-blue matte background. An unordered loose scatter, with clear bare blue space between all specimens. Two kinds of specimens: (1) irregular broken fragments of brittle dead leaves, torn chips and narrow splinters, no whole leaf silhouettes, no stems with whole leaves; dusty grey sepia, tawny umber, cinnamon, tobacco, with occasional fine leaf venation inside a fragment, faded, papery and flattened, 3–12 mm in life; (2) very fine broken earth-coloured hair-like dry woody root fibres, varied bends and thickness, some forked, all short strands 10–25 mm long. Each object shows authentic macro photographic surface detail. A cross-polarized diffuse hemispherical light tent; no cast shadows or highlights. Focus stacked. No text, no layout rules, no ruler, no dividers, no labels. Frame is an image extraction source plate, not an illustration. Keep all pieces fully inside frame, including tips.

**Mineral specimens**

> Photorealistic-natural. Create a square scientific macro specimen photograph, top-down, of about 75 tiny naturally weathered angular stone inclusions from a Florida sandy-fill yard. Lay every separate specimen well apart on a perfectly plain bright cyan studio extraction background. No stones touching, generous blue space between items, no items clipped. The specimens are 3-15 mm in real life. About one third are creamy, slightly porous off-white and tan limestone chips. Others are dusty grey, charcoal-grey, warm taupe, ochre-brown and muted iron-rust coloured mineral chips. Most are subtle mottled earthy colours. All are irregular and weathered, some faceted and flaky, some rounded, pitted or mottled, a few elongated pieces. Grains of fine dry earth embedded in the rough porous interior surfaces of many chips. Uniform diffuse integrating-sphere lighting and full focus to capture material colour, no cast shadow, no directional shading, no sparkles. Authentic photographic microstructure. No labels, no text, no annotations, no frame, no scale bars. No gravel mound, no gemstones.

</details>
