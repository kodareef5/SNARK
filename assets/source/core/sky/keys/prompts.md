# Sky mood keys: prompt log

Tool: built-in `image_gen.imagegen`, three calls. Only the user-supplied game render and our own generated paintings were image inputs. No external visual references. Images returned by the tool were copied unchanged into `originals/` before further work.

Generation prompts below are verbatim. Subsequent cropping, interpolation, exposure and colour grading, the noon sun-position correction, emission-disc colour preservation, labels, sampling and export were deterministic local Python operations, recorded in `scripts/build_style.py`; there were no additional image-tool prompts.

## 01: Toward the sun, initial eight-panel colour script

Reference: `../../structures/stone/ref/renders/house_hero.jpg` (the user-supplied render; material reference only).

```text
Use case: stylized-concept.
Asset type: film lighting artist's painted colour script for an original tropical survival game.
Primary request: Create ONE square 2048 x 2048 image containing EXACTLY EIGHT equal wide 2:1 landscape paintings in a seamless 2-column by 4-row grid. Read left to right, top to bottom: dawn, morning, noon, afternoon, golden hour, sunset, dusk, night. No text, labels, gutters, margins, swatches or typography anywhere. Each panel occupies precisely half the width and one quarter the height.
Input image 1 is ONLY our game's stone-building material/shape reference: squared grey limestone masonry with broad uneven blocks, dark timber lintels. Invent our island, not another game's.
Scene invariants: Every panel shows the IDENTICAL fixed view from the same low headland overlooking a gently curving tropical beach with a jungle headland on the left, calm open sea to the level horizon, a distant low island at the far left. In the bottom right foreground a modest squared limestone survivor-base wall with a timber edge, two visible planes, and some ground in front. A pair of identical small flat neutral-grey rectangular calibration cards lies face-up on that ground near bottom centre: left card in the open light, right card inside the wall's cast shadow. Both must be visible, unobstructed, distinct from bright sand. No people, boats, cities or mountains.
Composition: SKY IS THE SUBJECT, about 75% of each panel; horizon at exactly 75% panel height, ground and coast only the lowest quarter. This is a painted wide sky elevation study: top edge represents near zenith (90 degrees), level horizon represents zero degrees, with smoothly compressed perspective in the land. The sun sits at x=64% of panel width. Put its centre at the ACTUAL HEIGHT for each key: dawn at 2 degrees just above horizon, morning at 15 degrees, noon at 66 degrees high near the top, afternoon 35 degrees, golden hour 8 degrees, sunset a half-disc exactly on the horizon. Dusk sun is below horizon, invisible. Night has high moon instead. Do NOT reuse a low sun at noon. Keep sun discs small, atmospheric glow broad and soft. A few long delicate broken cloud ribbons recur in each panel, luminous upper edge and cooler underside; mostly open clear sky.
Style/medium: a beautiful, confident hand-painted production colour key, luminous quiet light and economical flat-brush planes, subtle broken brush edges, softened distant forms, very few sharp foreground accents. Neither photograph nor cartoon, no photographic detail, no 3D rendering, no airbrushed videogame screenshot. Coherent brushwork and identical geography in ALL EIGHT panels. Clouds are thin horizontal brush ribbons, not towering cumulus. Keep gradients smooth but subtly painted, not gritty paper noise.
Palette identity: mineral cobalt overhead, pale celadon and pearl sea-haze on the horizon, warm limestone, blue-violet shadows; warmth is apricot, honey and burnt copper, never fluorescent orange or fuchsia. Luminous sky and comparatively subdued ground, not uniformly bright postcard lighting.
Exact eight lighting keys:
1 DAWN, sun +2 degrees: cool clean slate-cobalt upper sky, pale pearl and a very narrow soft apricot sunward horizon. Blue-shadowed land, only a slight peach edge on the wall. This is first light, NOT fiery sunset.
2 MORNING +15: fresh clear slightly cool azure, pearl/celadon horizon, warm gold direct sunlight, long clear blue shadows.
3 NOON +66: saturated tropical cobalt overhead, very luminous sea-green-white horizon, hard white-gold sun high overhead, turquoise water, readable low-valued jungle. Day sky must be darker at zenith than at horizon.
4 AFTERNOON +35: same mineral blue but softer and hazier, warm pale-gold horizon and limestone, sun visibly lower than noon, deeper blue shade.
5 GOLDEN HOUR +8: honey and amber light rakes the wall, a narrow glowing apricot horizon below a blue upper sky, very long cool blue-violet shadows. Warm light but low exposure on ground, sky retains blue.
6 SUNSET 0: orange-red small sun half on the calm sea's rim, luminous copper/apricot low sky, upper sky muted violet-blue, clouds copper rim and mauve-grey underneath. Land subdued dark blue, not an orange silhouette.
7 DUSK -8: NO sun disc. Deep blue upper sky with only a few first stars, a THIN ember-orange horizon strip, dusky violet transition. Dark blue-grey yet readable stone and ground, no artificial lights.
8 NIGHT: high small silvery moon, deep ink blue upper sky, brighter marine-blue horizon and a broad faint silver-blue moon halo. Blue-grey land readable in quiet silver moonlight. Sparse tiny stars, no Milky Way, no huge moon, no teal neon, no fantasy purple.
Exposure requirements, very important: The two grey cards must be low-value painted calibration witnesses, NOT white props. Open card neutral-equivalent sRGB levels for the 8 keys are 59,91,123,111,64,49,36,36. Shaded card levels 35,70,70,70,55,29,21,21. Warm/cool hues are allowed, but keep those approximate brightnesses. Especially golden-hour land is dark despite glowing sky. At noon the sky 30 degrees up has brightness around sRGB (150,190,230), with zenith noticeably darker. At night do not crush all scenery to black. Do not print numbers on the cards.
Constraints: eight views of ONE island, one painter, consistent camera and masonry silhouette. Clear material reference to the supplied image. No external photos or other game's artwork. No borders, no letters.
```




## 02: Away from the light, companion eight-panel colour script

References: `originals/01-toward-generated.png`, then the user-supplied game render.

```text
Use case: lighting-weather and stylized-concept.
Create the COMPANION ANTI-SOLAR colour script to input image 1. Input 1 is our just-painted eight-hour island study and sets the exact hand, palette, exposure relationships, sky/ground proportions, recurring thin clouds and material simplicity. Input 2 is the same original game limestone-building reference.
ONE square image, eight equal 2:1 panels, seamless 2 columns x 4 rows, no borders, labels, text, swatches or typography. Same hour order as input 1: dawn +2, morning +15; noon +66, afternoon +35; golden hour +8, sunset 0; dusk -8, night with high moon.
Now turn the camera 180 degrees AWAY from the sun (at night AWAY from the moon). The direct light is behind the viewer, so no sun, moon, bright circular glow, specular glitter path on the water, or disc anywhere. It is the same low headland on the same tropical island looking the other way across its calm coast, not a new island. Consistent silhouette through all eight away-view panels: squared low limestone survivor-base wall and timber edge on LEFT foreground, beach curves into dense simple jungle on RIGHT, calm sea and long flat horizon. Two flat small grey cards face-up on ground near bottom centre, left in the open, right in the wall's shade. Same cards as input 1, dark neutral calibration cards, not white. A few thin cloud ribbons repeat in all panels with lit edges and cooler undersides. Keep the land ONLY in the bottom quarter, horizon exactly 75% of each panel height. Sky top represents near zenith; 30 degrees is 2/3 of way down the sky. Remain wide and airy. Same economical painterly flat brushwork as input 1, simplified land forms; not photoreal, not cartoon, not more polished or detailed.
Away-side sky behaviour is the essential change:
DAWN: clean slate-blue overhead into pale cool lavender/blue-grey horizon, very soft old-rose band over earth's blue shadow. No warm sunward glow.
MORNING: fresh mineral azure overhead, luminous pale blue/celadon horizon. The low golden sunlight comes from behind camera, warms limestone and tops of plants, long blue shadows.
NOON: rich mineral cobalt zenith, easing to clear blue at 30 degrees (approximately sRGB 150,190,230, this area MUST be significantly brighter than in input 1), finally pearl-celadon haze at sea horizon. No sun or localized glow. Hard warm-white sunlight on wall and ground, blue shade. Zenith always darker than horizon.
AFTERNOON: mineral blue/cobalt upper sky, slightly warm pearl haze on horizon, softer hazier air than morning; warm limestone and blue shade.
GOLDEN HOUR: calm cornflower blue upper sky, very gentle dusty pink low band over cool pearl horizon, amber raking light from behind viewer warmly catches broad wall planes, blue-violet shadow. Do not turn the entire sky orange.
SUNSET: deepening violet-blue overhead; a clearly visible, broad muted rose band ABOVE a distinct blue-grey earth-shadow band sitting directly on horizon. NO orange sunward glow at all. The anti-solar rose band is a soft pink atmospheric layer, NOT a pink cloud. Soft warm-red last light on limestone, cool dark ground.
DUSK: deep ink blue zenith, a higher, subtler dusty rose-violet arch ABOVE a risen blue-grey earth shadow occupying the lowest 15% of sky. A few first tiny stars. NO orange horizon and NO bright disc. Both atmospheric layers soft and horizontal.
NIGHT: moon behind the viewer, NO moon in picture. Deep mineral marine-blue sky, lighter toward horizon, thin dark blue clouds with gently silver lit edges, sparse tiny stars, readable cool silver-blue-grey limestone and plants, no turquoise neon.
Open-card neutral-equivalent sRGB brightness by panel:59,91,123,111,64,49,36,36; shade-card:35,70,70,70,55,29,21,21. Land must respect low exposure, particularly golden hour, sunset, dusk and night. Do not make bright grey cards like white rocks. Match input 1's overall night readability.
One painter, one island, eight different hours. Change view direction and light direction; preserve the hand and palette. No UI, labels, frame, words, humans, extra buildings, mountains, watermarks.
```





## 03: Golden hour, larger hand study

References: `originals/01-toward-generated.png`, then the user-supplied game render.

```text
Use case: stylized-concept. Asset: a larger hand study for the exact GOLDEN HOUR panel (third row, left) of reference image 1. Reference image 2 shows our game's actual squared limestone and timber.
Paint one wide 2:1 landscape, intended for 2048 x 1024. No grid, no text, no border.
Preserve the original composition exactly: same low headland, curving beach and jungle on left, calm horizon at 75% height, open sea centre, limestone wall/timber edge in right foreground, two flat neutral-grey cards lying on ground near bottom centre. The left card is in the open and the right card in wall shade. Same limestone block character as reference 2. Sky occupies three quarters. Sun is a small disc 8 degrees above the horizon, at x64%, about y68.3% in this wide painted elevation study. No people, boats or buildings added.
Match the elegant flat-brush hand and palette of reference 1, but simplify the microtexture: large confident shapes, soft luminous atmosphere, delicate broken cloud ribbons with amber edges and cool mauve undersides, crisp isolated limestone edges and palm tips. Sky colour is smooth luminous layered paint, not obvious uniform diagonal scratches. It must be a film lighting colour key, neither photograph nor cartoon.
Crucial exposure: keep the land low-valued despite the golden light. Left open neutral-grey card has equivalent sRGB brightness64, warmed amber (roughly 88,55,31); right shaded card brightness55, cool blue (roughly39,56,78). Ground and masonry light must follow that exposure, no white card. Thin raking honey highlights on wall, strong complementary blue-violet shadows. Blue mineral upper sky (near48,78,125) opens gradually to luminous apricot at horizon (near223,154,94); the brighter sky is what makes the dark island glow. Sea is quiet and reflects the warm horizon, a narrow sun glitter path only. No orange wash covering the top half. Sparse fine clouds, NO stars.
One beautiful quiet warm hour on our island, refined at larger scale but unmistakably the same painter as the sheet.
```

Tool: built-in `image_gen.imagegen`. Only the supplied game render and our own generated studies are image inputs. No external image references.



# Round 2: The registered panorama keys

Built-in image tool, one call per key. Input 1: that key’s physical underlay; input 2: our own style sheet. Exact prompts follow. Scripts retain the registered base geometry and perform final projection, exposure and palette corrections.

## 04: dawn panorama

References: underlay/dawn.png, style/sheet.png

```text
Use case: lighting-weather. Asset: the DAWN production sky mood key for our original tropical survival game.
Input 1 is the exact equirectangular physical-sky underlay and EDIT TARGET. Input 2 is our own previous style sheet, STYLE REFERENCE ONLY (do not copy its scene). Paint a beautiful lighting-artist colour key over input 1, keeping its projection and geography, guided by its physical brightness directions but with the mood below.
Output ONE 2048 x 1024 RGB wide 2:1 full 360-degree equirectangular panorama. Horizon at y=512, zenith at y=0; the whole upper half is sky. x=0 and x=2048 join seamlessly. At the zenith all headings are one point, so upper rows are horizontally uniform; no clouds above elevation 65 degrees. Do not turn this into a normal landscape perspective.
Mood: Cleanest light of the day: PALE COOL LUMINOUS CLEAR BLUE overhead, never slate, never gloomy. Luminous pearl and a delicate peach low toward the sun at x=1616, with land still in blue shade. Away side on the left remains pearl with the faintest rose and cool blue shadow. Light air, quiet first light, not fiery sunset.
Hand: Limestone / Lagoon / Ember. Luminous broad quiet paint, smooth layered air with extremely subtle organic paint variation. Economical atmospheric colour key, neither photograph nor cartoon. Just THREE or FOUR VERY FINE translucent broken cirrus filaments below 40 degrees, with huge clean clear-sky areas. No bulky clouds, no cloud ceiling, no uniform diagonal brush scratches. Clouds are accents, not the subject. Keep clear sky around the top centre, the away 30-degree point, and the toward/away 3-degree points. Cloud-free within 4 degrees of each.
Sun diameter 1.2 degrees, moon 1.5 degrees: only about 7 and 9 pixels tall respectively in this projection, horizontally stretched near the zenith. Broad soft glow, tiny discs. No other bright discs. NO TEXT OR MARKERS.
Geometry invariant: keep the EXISTING GAME LAND on EXACTLY the same pixels as input 1: all slopes, the level sea line, the three calibration cubes/card, trees, water shapes, checker ground, every silhouette. Only lighting/colour may change. No added vegetation, jungle, mountains, coastline, buildings, scenery, rocks or details. The lower half remains the plain game proving ground. Land is secondary and much darker than the sky. Do not beautify or reconstruct it.
```

## 05: morning panorama

References: underlay/morning.png, style/sheet.png

```text
Use case: lighting-weather. Asset: the MORNING production sky mood key for our original tropical survival game.
Input 1 is the exact equirectangular physical-sky underlay and EDIT TARGET. Input 2 is our own previous style sheet, STYLE REFERENCE ONLY (do not copy its scene). Paint a beautiful lighting-artist colour key over input 1, keeping its projection and geography, guided by its physical brightness directions but with the mood below.
Output ONE 2048 x 1024 RGB wide 2:1 full 360-degree equirectangular panorama. Horizon at y=512, zenith at y=0; the whole upper half is sky. x=0 and x=2048 join seamlessly. At the zenith all headings are one point, so upper rows are horizontally uniform; no clouds above elevation 65 degrees. Do not turn this into a normal landscape perspective.
Mood: Fresh slightly cool clear azure overhead, luminous pearl/celadon haze at the sea line. Small gold sun at x=1583 y=426. Long warm light and blue shade. Mineral-blue family of the second panel of reference 2. Air feels dew-clear.
Hand: Limestone / Lagoon / Ember. Luminous broad quiet paint, smooth layered air with extremely subtle organic paint variation. Economical atmospheric colour key, neither photograph nor cartoon. Just THREE or FOUR VERY FINE translucent broken cirrus filaments below 40 degrees, with huge clean clear-sky areas. No bulky clouds, no cloud ceiling, no uniform diagonal brush scratches. Clouds are accents, not the subject. Keep clear sky around the top centre, the away 30-degree point, and the toward/away 3-degree points. Cloud-free within 4 degrees of each.
Sun diameter 1.2 degrees, moon 1.5 degrees: only about 7 and 9 pixels tall respectively in this projection, horizontally stretched near the zenith. Broad soft glow, tiny discs. No other bright discs. NO TEXT OR MARKERS.
Geometry invariant: keep the EXISTING GAME LAND on EXACTLY the same pixels as input 1: all slopes, the level sea line, the three calibration cubes/card, trees, water shapes, checker ground, every silhouette. Only lighting/colour may change. No added vegetation, jungle, mountains, coastline, buildings, scenery, rocks or details. The lower half remains the plain game proving ground. Land is secondary and much darker than the sky. Do not beautify or reconstruct it.
```

## 06: noon panorama

References: underlay/noon.png, style/sheet.png

```text
Use case: lighting-weather. Asset: the NOON production sky mood key for our original tropical survival game.
Input 1 is the exact equirectangular physical-sky underlay and EDIT TARGET. Input 2 is our own previous style sheet, STYLE REFERENCE ONLY (do not copy its scene). Paint a beautiful lighting-artist colour key over input 1, keeping its projection and geography, guided by its physical brightness directions but with the mood below.
Output ONE 2048 x 1024 RGB wide 2:1 full 360-degree equirectangular panorama. Horizon at y=512, zenith at y=0; the whole upper half is sky. x=0 and x=2048 join seamlessly. At the zenith all headings are one point, so upper rows are horizontally uniform; no clouds above elevation 65 degrees. Do not turn this into a normal landscape perspective.
Mood: Hard saturated tropical day. Deep MINERAL BLUE overhead and luminous pearl/celadon sea haze. Keep the blue rich and clear, not electric. Sky at 30 degrees away is pale blue around 150,190,230. Sun at x=1109 y=132. White-gold limestone and turquoise hints in water. Strong brightness gradient from blue ceiling to pale horizon.
Hand: Limestone / Lagoon / Ember. Luminous broad quiet paint, smooth layered air with extremely subtle organic paint variation. Economical atmospheric colour key, neither photograph nor cartoon. Just THREE or FOUR VERY FINE translucent broken cirrus filaments below 40 degrees, with huge clean clear-sky areas. No bulky clouds, no cloud ceiling, no uniform diagonal brush scratches. Clouds are accents, not the subject. Keep clear sky around the top centre, the away 30-degree point, and the toward/away 3-degree points. Cloud-free within 4 degrees of each.
Sun diameter 1.2 degrees, moon 1.5 degrees: only about 7 and 9 pixels tall respectively in this projection, horizontally stretched near the zenith. Broad soft glow, tiny discs. No other bright discs. NO TEXT OR MARKERS.
Geometry invariant: keep the EXISTING GAME LAND on EXACTLY the same pixels as input 1: all slopes, the level sea line, the three calibration cubes/card, trees, water shapes, checker ground, every silhouette. Only lighting/colour may change. No added vegetation, jungle, mountains, coastline, buildings, scenery, rocks or details. The lower half remains the plain game proving ground. Land is secondary and much darker than the sky. Do not beautify or reconstruct it.
```

## 07: afternoon panorama

References: underlay/afternoon.png, style/sheet.png

```text
Use case: lighting-weather. Asset: the AFTERNOON production sky mood key for our original tropical survival game.
Input 1 is the exact equirectangular physical-sky underlay and EDIT TARGET. Input 2 is our own previous style sheet, STYLE REFERENCE ONLY (do not copy its scene). Paint a beautiful lighting-artist colour key over input 1, keeping its projection and geography, guided by its physical brightness directions but with the mood below.
Output ONE 2048 x 1024 RGB wide 2:1 full 360-degree equirectangular panorama. Horizon at y=512, zenith at y=0; the whole upper half is sky. x=0 and x=2048 join seamlessly. At the zenith all headings are one point, so upper rows are horizontally uniform; no clouds above elevation 65 degrees. Do not turn this into a normal landscape perspective.
Mood: The same tropical mineral-blue day grown warmer and hazier. Softened mineral blue overhead, pale warm pearl low down, a white-gold sun at x=697 y=312. Warm light with cool blue shade. Less severe than noon.
Hand: Limestone / Lagoon / Ember. Luminous broad quiet paint, smooth layered air with extremely subtle organic paint variation. Economical atmospheric colour key, neither photograph nor cartoon. Just THREE or FOUR VERY FINE translucent broken cirrus filaments below 40 degrees, with huge clean clear-sky areas. No bulky clouds, no cloud ceiling, no uniform diagonal brush scratches. Clouds are accents, not the subject. Keep clear sky around the top centre, the away 30-degree point, and the toward/away 3-degree points. Cloud-free within 4 degrees of each.
Sun diameter 1.2 degrees, moon 1.5 degrees: only about 7 and 9 pixels tall respectively in this projection, horizontally stretched near the zenith. Broad soft glow, tiny discs. No other bright discs. NO TEXT OR MARKERS.
Geometry invariant: keep the EXISTING GAME LAND on EXACTLY the same pixels as input 1: all slopes, the level sea line, the three calibration cubes/card, trees, water shapes, checker ground, every silhouette. Only lighting/colour may change. No added vegetation, jungle, mountains, coastline, buildings, scenery, rocks or details. The lower half remains the plain game proving ground. Land is secondary and much darker than the sky. Do not beautify or reconstruct it.
```

## 08: golden panorama

References: underlay/golden.png, style/sheet.png

```text
Use case: lighting-weather. Asset: the GOLDEN production sky mood key for our original tropical survival game.
Input 1 is the exact equirectangular physical-sky underlay and EDIT TARGET. Input 2 is our own previous style sheet, STYLE REFERENCE ONLY (do not copy its scene). Paint a beautiful lighting-artist colour key over input 1, keeping its projection and geography, guided by its physical brightness directions but with the mood below.
Output ONE 2048 x 1024 RGB wide 2:1 full 360-degree equirectangular panorama. Horizon at y=512, zenith at y=0; the whole upper half is sky. x=0 and x=2048 join seamlessly. At the zenith all headings are one point, so upper rows are horizontally uniform; no clouds above elevation 65 degrees. Do not turn this into a normal landscape perspective.
Mood: The hour players stop to look. BROAD LUMINOUS HONEY/APRICOT warmth fills the entire quarter of sky around the low sun, not a narrow horizon stripe. Sun at x=617 y=466. Gradually turn the warm apricot air into a SOFTER WARMER BLUE overhead. Away on right, quiet blue with restrained rose/pearl low. Warm raking honey on the existing cube planes, blue in their shade. This corrects the narrow warm stripe of reference 2.
Hand: Limestone / Lagoon / Ember. Luminous broad quiet paint, smooth layered air with extremely subtle organic paint variation. Economical atmospheric colour key, neither photograph nor cartoon. Just THREE or FOUR VERY FINE translucent broken cirrus filaments below 40 degrees, with huge clean clear-sky areas. No bulky clouds, no cloud ceiling, no uniform diagonal brush scratches. Clouds are accents, not the subject. Keep clear sky around the top centre, the away 30-degree point, and the toward/away 3-degree points. Cloud-free within 4 degrees of each.
Sun diameter 1.2 degrees, moon 1.5 degrees: only about 7 and 9 pixels tall respectively in this projection, horizontally stretched near the zenith. Broad soft glow, tiny discs. No other bright discs. NO TEXT OR MARKERS.
Geometry invariant: keep the EXISTING GAME LAND on EXACTLY the same pixels as input 1: all slopes, the level sea line, the three calibration cubes/card, trees, water shapes, checker ground, every silhouette. Only lighting/colour may change. No added vegetation, jungle, mountains, coastline, buildings, scenery, rocks or details. The lower half remains the plain game proving ground. Land is secondary and much darker than the sky. Do not beautify or reconstruct it.
```

## 09: sunset panorama

References: underlay/sunset.png, style/sheet.png

```text
Use case: lighting-weather. Asset: the SUNSET production sky mood key for our original tropical survival game.
Input 1 is the exact equirectangular physical-sky underlay and EDIT TARGET. Input 2 is our own previous style sheet, STYLE REFERENCE ONLY (do not copy its scene). Paint a beautiful lighting-artist colour key over input 1, keeping its projection and geography, guided by its physical brightness directions but with the mood below.
Output ONE 2048 x 1024 RGB wide 2:1 full 360-degree equirectangular panorama. Horizon at y=512, zenith at y=0; the whole upper half is sky. x=0 and x=2048 join seamlessly. At the zenith all headings are one point, so upper rows are horizontally uniform; no clouds above elevation 65 degrees. Do not turn this into a normal landscape perspective.
Mood: Small copper sun bisected by the SEA horizon, centre x=597 y=512. Toward left, copper-orange rim, luminous apricot transition. OVERHEAD STAYS DUSKY CLEAR BLUE, not purple. Violet and a dusty rose atmospheric band belong LOW on the AWAY RIGHT side over the earth blue-grey shadow. Opposite sun, a small moon rising at x=1621 y=512. Ground is low valued blue shade with last copper raking light.
Hand: Limestone / Lagoon / Ember. Luminous broad quiet paint, smooth layered air with extremely subtle organic paint variation. Economical atmospheric colour key, neither photograph nor cartoon. Just THREE or FOUR VERY FINE translucent broken cirrus filaments below 40 degrees, with huge clean clear-sky areas. No bulky clouds, no cloud ceiling, no uniform diagonal brush scratches. Clouds are accents, not the subject. Keep clear sky around the top centre, the away 30-degree point, and the toward/away 3-degree points. Cloud-free within 4 degrees of each.
Sun diameter 1.2 degrees, moon 1.5 degrees: only about 7 and 9 pixels tall respectively in this projection, horizontally stretched near the zenith. Broad soft glow, tiny discs. No other bright discs. NO TEXT OR MARKERS.
Geometry invariant: keep the EXISTING GAME LAND on EXACTLY the same pixels as input 1: all slopes, the level sea line, the three calibration cubes/card, trees, water shapes, checker ground, every silhouette. Only lighting/colour may change. No added vegetation, jungle, mountains, coastline, buildings, scenery, rocks or details. The lower half remains the plain game proving ground. Land is secondary and much darker than the sky. Do not beautify or reconstruct it.
```

## 10: dusk panorama

References: underlay/dusk.png, style/sheet.png

```text
Use case: lighting-weather. Asset: the DUSK production sky mood key for our original tropical survival game.
Input 1 is the exact equirectangular physical-sky underlay and EDIT TARGET. Input 2 is our own previous style sheet, STYLE REFERENCE ONLY (do not copy its scene). Paint a beautiful lighting-artist colour key over input 1, keeping its projection and geography, guided by its physical brightness directions but with the mood below.
Output ONE 2048 x 1024 RGB wide 2:1 full 360-degree equirectangular panorama. Horizon at y=512, zenith at y=0; the whole upper half is sky. x=0 and x=2048 join seamlessly. At the zenith all headings are one point, so upper rows are horizontally uniform; no clouds above elevation 65 degrees. Do not turn this into a normal landscape perspective.
Mood: Sun is 8 degrees BELOW horizon: NO SUN DISC. This is luminous twilight, much BRIGHTER THAN NIGHT. Deep clear BLUE zenith, substantially brighter than navy night. Broad afterglow toward LEFT at x=577: ember at sea line, then gold, then pale GREEN-BLUE, then deep blue upward. On RIGHT the rose atmospheric band sits above the earth blue shadow. Moon small at x=1601 y=466. Very few tiny first stars high. The sky is by far the brightest thing over dark but readable land. Do not copy the gloomy dusk in reference 2.
Hand: Limestone / Lagoon / Ember. Luminous broad quiet paint, smooth layered air with extremely subtle organic paint variation. Economical atmospheric colour key, neither photograph nor cartoon. Just THREE or FOUR VERY FINE translucent broken cirrus filaments below 40 degrees, with huge clean clear-sky areas. No bulky clouds, no cloud ceiling, no uniform diagonal brush scratches. Clouds are accents, not the subject. Keep clear sky around the top centre, the away 30-degree point, and the toward/away 3-degree points. Cloud-free within 4 degrees of each.
Sun diameter 1.2 degrees, moon 1.5 degrees: only about 7 and 9 pixels tall respectively in this projection, horizontally stretched near the zenith. Broad soft glow, tiny discs. No other bright discs. NO TEXT OR MARKERS.
Geometry invariant: keep the EXISTING GAME LAND on EXACTLY the same pixels as input 1: all slopes, the level sea line, the three calibration cubes/card, trees, water shapes, checker ground, every silhouette. Only lighting/colour may change. No added vegetation, jungle, mountains, coastline, buildings, scenery, rocks or details. The lower half remains the plain game proving ground. Land is secondary and much darker than the sky. Do not beautify or reconstruct it.
```

## 11: night panorama

References: underlay/night.png, style/sheet.png

```text
Use case: lighting-weather. Asset: the NIGHT production sky mood key for our original tropical survival game.
Input 1 is the exact equirectangular physical-sky underlay and EDIT TARGET. Input 2 is our own previous style sheet, STYLE REFERENCE ONLY (do not copy its scene). Paint a beautiful lighting-artist colour key over input 1, keeping its projection and geography, guided by its physical brightness directions but with the mood below.
Output ONE 2048 x 1024 RGB wide 2:1 full 360-degree equirectangular panorama. Horizon at y=512, zenith at y=0; the whole upper half is sky. x=0 and x=2048 join seamlessly. At the zenith all headings are one point, so upper rows are horizontally uniform; no clouds above elevation 65 degrees. Do not turn this into a normal landscape perspective.
Mood: Readable blue night. Deep marine/ink blue sky, brighter toward the horizon, a quiet silver-blue moon halo at x=1109 y=132. The small moon is 66.73 degrees up. Sparse tiny stars, a few brighter, no milky way or nebula. Grey cube planes catch silver blue light, land quiet blue-grey, low-valued but navigable. No fantasy purple, no teal neon.
Hand: Limestone / Lagoon / Ember. Luminous broad quiet paint, smooth layered air with extremely subtle organic paint variation. Economical atmospheric colour key, neither photograph nor cartoon. Just THREE or FOUR VERY FINE translucent broken cirrus filaments below 40 degrees, with huge clean clear-sky areas. No bulky clouds, no cloud ceiling, no uniform diagonal brush scratches. Clouds are accents, not the subject. Keep clear sky around the top centre, the away 30-degree point, and the toward/away 3-degree points. Cloud-free within 4 degrees of each.
Sun diameter 1.2 degrees, moon 1.5 degrees: only about 7 and 9 pixels tall respectively in this projection, horizontally stretched near the zenith. Broad soft glow, tiny discs. No other bright discs. NO TEXT OR MARKERS.
Geometry invariant: keep the EXISTING GAME LAND on EXACTLY the same pixels as input 1: all slopes, the level sea line, the three calibration cubes/card, trees, water shapes, checker ground, every silhouette. Only lighting/colour may change. No added vegetation, jungle, mountains, coastline, buildings, scenery, rocks or details. The lower half remains the plain game proving ground. Land is secondary and much darker than the sky. Do not beautify or reconstruct it.
```
# Round 3: Afternoon warmth edit

Built-in image tool; edit target `rounds/round-2/afternoon.png`; retained output `originals/12-afternoon-round-3.png` (1774 × 887). Only the broad sky colour is used, with the old cloud strokes, exact land, and celestial registration retained by the build.

+Use case: lighting-weather.
Asset type: existing 2:1 equirectangular game sky mood key.
Input image 1 is the edit target, afternoon.png, a precisely registered proving-ground panorama. Change only its SKY LIGHTING: restore a more saturated luminous azure upper sky, with a clear mineral blue overhead, and turn the grey-white wash toward the sun into warm gold-white light. A broad but delicate gold-white halo surrounds the existing small sun at x 697/2048, y 312/1024 and connects to pearl-gold haze low toward that heading. The upper sky remains clear blue, and away from the sun is fresh blue over pale celadon haze. The blue at 30 degrees away should be near sRGB (110,192,252), bright yet saturated. Keep the existing thin cloud ribbon positions and character. Preserve the full panorama projection, exact horizon, all terrain/cube/card geometry and colours, deep blue sea, small 1.2 degree sun disc position and size, no new scenery, no large clouds, no text. Preserve the left-right join. This is a restrained film lighting colour key, not a photograph. We will transfer only broad sky colour from this edit back onto the registered original.
# Round four noon colour field

Built-in imagegen edit. Edit target: `rounds/round-3/noon.png`. Palette reference: `rounds/round-3/golden.png`. Untouched output: `originals/13-noon-round-4.png`.

Use case: lighting-weather. Edit target: first image, our registered equirectangular noon sky mood key. Second image is only a palette and atmosphere reference, our approved golden hour of the same game on the same island. Change only the noon sky's broad colour field, preserving terrain, water, horizon, projection, thin cloud positions and sun location. The deepest blue must be cerulean to cobalt at 20 to 40 degrees elevation on the side AWAY from the sun, near the left and right edges of this panorama at about y=340 out of 1024. Aim for RGB 60,130,215 there. The zenith at the top is a little LIGHTER and softer, roughly 78,143,220, because it is only 23 degrees from the high sun. Clear luminous blue around the high sun, becoming bright round the sun. Low horizon is pale clear aqua blue; very modest pearl sunward, no cream band around the entire horizon. Natural luminous tropical game lighting, restrained painterly mood key, same hand as the golden reference, not electric cyan and not a dark blue ceiling. Keep all geometry exactly, no new scenery or clouds. Enlarge sun disc to 2 degrees across, about 11 pixels vertically on a 1024 tall equirectangular panorama, widened horizontally by the spherical projection at 66.73 degrees elevation, softly luminous limb with a round angular glow. Output one panorama matching first image 2:1. No text, no frames.
