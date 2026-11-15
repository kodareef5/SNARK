# Limestone / Lagoon / Ember

These are the first sky style studies: one island, eight hours, two directions. [Toward the light](sheet.png), [away from the light](away.png), and the [larger golden-hour painting](golden-hour-study.png) establish the palette and hand before the proving-ground renders arrive.

## The character

Our daylight has a mineral blue ceiling and a pale celadon, almost porcelain horizon. The limestone belongs to that cool family until low sunlight catches it. Warmth then arrives as a thin apricot seam, honey on the wall, and finally copper at the sea's rim. It never needs to replace all the blue. Across the sun, dusty rose floats above the earth's blue-grey shadow. Night returns the wall to silver and the water to marine blue.

The recognizable combination is **chalky limestone, a cool luminous sea-haze, and a small, persistent ember line beneath a large blue sky**. Broad quiet air and fine broken cloud ribbons give the day room to breathe. Saturated noon, a lingering warm hour, and navigable blue night supply the tropical survival feeling; our material colours and the narrow warmth/cool-air relationship give it its own identity. No other game's art or sky photograph was used as an image input.

## The hand

- Build the sky from broad, smooth colour fields with slight brush variation. Give almost three quarters of each frame to air. Keep the darkest clear-sky blue overhead and gather luminance low down and near the light.
- Clouds are thin, broken horizontal ribbons. Let a few edges catch warm light; keep their translucent undersides cooler. Avoid a ceiling of detailed cumulus. At dusk, “lit” means residual afterglow; at night it means moonlight.
- Reduce jungle to overlapping masses with a few palm tips. Reduce masonry to uneven rectangular planes, a timber cap, and a few decisive joints. Reserve the hardest edges for nearby stone, the cards, and occasional leaves. Distant coast edges dissolve.
- The sky makes the picture luminous. Keep the land within its exposure. A vertical wall catching grazing sunlight can be much brighter than the face-up card at golden hour.
- Blue shade remains visible even beside honey light. Dusk and night have similarly dark ground; the residual ember and rose sky distinguish dusk from night.

## Palette read from the delivered panels

All triples below are **8-bit sRGB, D65**, measured after grading and export. These are pixel readings, not values merely copied from a generation prompt. The [palette board](palette.png) shows the same samples. [CSV](palette.csv) and [JSON](palette.json) provide machine-readable values.

| Hour | Near zenith | 30° away | Horizon toward light | Horizon away |
| --- | --- | --- | --- | --- |
| Dawn | (54, 78, 123) | (105, 128, 175) | (197, 155, 145) | (160, 158, 177) |
| Morning | (45, 108, 176) | (128, 174, 217) | (211, 214, 205) | (199, 217, 223) |
| Noon | (29, 86, 161) | (150, 190, 230) | (220, 233, 225) | (213, 234, 233) |
| Afternoon | (53, 109, 174) | (136, 170, 210) | (224, 201, 166) | (214, 208, 196) |
| Golden Hour | (48, 78, 125) | (126, 141, 176) | (222, 154, 94) | (155, 156, 179) |
| Sunset | (48, 56, 102) | (107, 97, 145) | (215, 104, 65) | (95, 111, 153) |
| Dusk | (16, 29, 58) | (47, 51, 91) | (139, 68, 53) | (45, 56, 90) |
| Night | (9, 19, 38) | (18, 36, 67) | (42, 66, 101) | (36, 56, 88) |

| Hour | Open grey card | Shaded grey card | Cloud lit ribbon | Cloud shaded underside |
| --- | --- | --- | --- | --- |
| Dawn | (53, 59, 74) | (25, 35, 52) | (134, 140, 160) | (105, 123, 157) |
| Morning | (99, 90, 76) | (56, 71, 89) | (180, 192, 197) | (149, 179, 201) |
| Noon | (127, 123, 116) | (55, 71, 94) | (251, 242, 231) | (202, 206, 224) |
| Afternoon | (119, 110, 97) | (53, 71, 94) | (179, 181, 187) | (153, 170, 192) |
| Golden Hour | (76, 61, 47) | (39, 56, 78) | (170, 142, 116) | (139, 131, 131) |
| Sunset | (61, 46, 41) | (20, 29, 44) | (153, 98, 98) | (124, 94, 120) |
| Dusk | (36, 35, 45) | (15, 21, 32) | (81, 66, 86) | (74, 62, 86) |
| Night | (31, 36, 45) | (14, 21, 32) | (39, 51, 74) | (29, 43, 68) |


The zenith reading comes from the away view to avoid the source halo. Cards and clouds in the second table come from the toward view; both directions' card readings are in the data files. Horizon samples deliberately avoid the solar disc and bright water. The thin clouds have very shallow painted volume: the cloud pair records a bright ribbon and its cooler, translucent lower edge, rather than two faces of a thick cloud.

## Through the day

**Dawn (+2°):** slate blue air, a small apricot opening toward the sun, pale cool rose away. The open card remains blue because ambient skylight still dominates the horizontal ground; only grazing edges receive warmth.

**Morning (+15°):** cleaner azure and a pearl horizon. A little gold enters direct light, while the shade remains blue. The land comes up in value without losing long shadows.

**Noon (+66°):** the strongest mineral blue overhead and the clearest celadon-to-pearl haze below. Hard white-gold light, cool stone shade, turquoise shallows. The away sky at the 30° guide reads exactly **(150, 190, 230)**; its neutral-equivalent brightness is **185.87**.

**Afternoon (+35°):** less austere blue, a softer, warmer low sky, and the first substantial gold on limestone. Haze broadens the low light without bleaching the zenith.

**Golden hour (+8°):** honey and amber belong to the sunward horizon and the wall's catching planes. Most of the sky stays blue; the reverse view receives a faint rose band. The open/shade card gap is deliberately small at 64/55 even though vertical surfaces catch strong raking light.

**Sunset (0°):** copper-orange at the rim, violet-blue above. Away, the rose band sits over a distinct blue earth shadow. Preserve this directional difference; do not apply an orange wash to the whole dome.

**Dusk (−8°):** the zenith is already deep blue. A thin ember remains sunward; the away earth shadow has risen and the rose is subdued. The first sparse stars appear. The ground receives sky afterglow, not direct sunlight.

**Night (high moon):** dark marine air, a brighter horizon and a local silver halo. The card is 36 in the open and 21 in shade. Stone, beach and jungle remain separable; stars stay sparse. For the night row, “toward/away” follows the **moon**, the active light. The sun is opposite it and below the horizon.

## Exposure and how to read it

The card material is the brief's nominal sRGB-128 grey. Its painted output is tinted by the light. Compare brightness using linear luminance, not the arithmetic average of its R, G and B channels:

`sRGB → linear RGB; Y = 0.2126 R + 0.7152 G + 0.0722 B; neutral = sRGB_encode(Y) × 255`.

| Hour | Open target | Toward / away measured | Shade target | Toward / away measured |
| --- | ---: | ---: | ---: | ---: |
| Dawn | 59 | 59.04 / 59.04 | 35 | 34.71 / 34.71 |
| Morning | 91 | 91.11 / 91.16 | 70 | 69.68 / 69.78 |
| Noon | 123 | 123.38 / 123.38 | 70 | 70.01 / 70.01 |
| Afternoon | 111 | 111.13 / 111.13 | 70 | 69.70 / 69.70 |
| Golden Hour | 64 | 63.70 / 64.38 | 55 | 54.92 / 54.81 |
| Sunset | 49 | 49.30 / 49.30 | 29 | 28.72 / 28.72 |
| Dusk | 36 | 36.03 / 36.03 | 21 | 20.85 / 20.85 |
| Night | 36 | 35.74 / 35.74 | 21 | 20.69 / 20.69 |


Across the 32 card samples, the largest error is **0.38 sRGB levels**. The larger golden-hour painting measures **63.70 / 54.92**, against **64 / 55**. Every sampled horizon is brighter than its key's sampled zenith. Each sampled cloud light is brighter than its shaded edge. These checks cover the recorded regions, not every pixel or all atmospheric directions.

## Sampling and transfer to the game

Each clean panel is 1024 × 512; the presentation sheets are 2136 × 2524. Coordinates are measured inside each panel, with the origin at its upper left. The study uses a painted elevation guide: near-zenith at the top, sea horizon at about `y=0.744H`, and 30° at `y=0.496H`. It is **not a calibrated camera projection**. Sun heights are approximate compositional cues; the final render must establish exact geometry.

The sky/card readings use a 7 × 7 pixel channel median; fine cloud edges use 3 × 3. [Sample coordinates](../reports/samples.json) include the panel filename, exact panel and sheet pixel coordinates, radius, RGB and luminance. [Toward markers](../reports/samples-toward.png) and [away markers](../reports/samples-away.png) identify the sampled regions without marking up the paintings. The final paintings and presentation exports carry an sRGB profile.

Fit the atmosphere to clear-air samples after fixing the hour's exposure. Treat the sun or moon disc, its halo, cloud strokes, foliage, and water as separate visual evidence. Brush texture is an editorial surface, not a LUT requirement. Interpolate the low-dimensional grading controls smoothly between hours; judge the intervening sky as well as the eight anchors. The local grading script uses hand masks to finish a painting; it is not the proposed runtime algorithm.

The render team's final 2048 × 1024 keys should retain these relationships while replacing our invented coast with the actual proving ground. Verify the exact card orientation, sun/moon direction, sky angles and stone albedo there. A successful fit to the physical table has **not** yet been demonstrated.
