# Berry bushes — exact generation prompts

All images use the built-in image generation tool. No external image references were used. The local world map was inspected only for setting context and was not supplied to the image model. Full returned PNGs are retained without resizing or repainting. Each entry records its supplied image references and literal prompt.

## 01 — Direction A, initial

References: none. `transparent_background: false`.

```text
Use case: stylized-concept.
Asset type: production concept art for an original realistic survival-game berry shrub, direction A, "Forkleaf".
Create one photorealistic high-end modern game screenshot-quality plant study, maximum available native resolution, landscape 3:2. Work solely from this text, without references to existing games or artworks.
Scene: one whole shrub alone on plain pale sandy ground with sparse short dry-green coastal grass, quiet neutral background consisting only of the same ground. Warm afternoon sunlight from upper left, soft blue sky fill in shadows, hot humid coastal atmosphere. No landscape distractions, no horizon sky band, no text, labels, border, UI or people.
Camera: standing player eye at 1.7 m high, horizontal distance about 2.5 m from shrub centre, looking down slightly in a three-quarter view. Entire bush including base and outermost tips visible, centred, useful margins, bush fills about 75% of image width. See both its crown and its side, never a low camera.
Subject: original waist-high subtropical coastal shrub 1.1 m high and 1.4 m wide, irregular squat rounded outline, almost foliage to ground, five short brown woody stems branching near ground into an asymmetric open framework. No central tree trunk. Leaf mass is made of roughly 30 distinct leafy twig sprays, each visibly on one or two forked stems, overlapping into 5 irregular lobes with deep shadowed hollows and several genuine see-through gaps. The silhouette is scalloped by sprays rather than clipped.
Direction A botany: stiff outward-upward Y-forked twigs carrying loose fans of 8-14 simple smooth-edged elliptical leaves 4-6 cm long, modest pointed tips, slightly cupped, dark cool bottle green, glossy leathery surfaces with broad natural highlights. Alternating leaves and readable stems, no fern compound fronds. A few bitten leaves, two muted yellow-green senescent leaves, one dead twig. Inner foliage darker and sparse; brown branch structure visible in holes.
Berries: exclusively ripe red, small spherical 0.8-1.2 cm berries, each with its own tiny highlight. Each berry is about one fifth of a leaf length, never cherry-sized. Approximately 24 irregular loose clusters of 8-18 berries on short branching pedicels at twig tips and occasional outer leaf axils. Clusters are little scarlet point constellations carried proud of the leaf silhouette, drooping slightly under weight, separated by visible green leaves. Distribute them across the front, sides AND upper crown, clearly accessible to a hand from all sides. Leave much more leaf area than fruit area. No giant grapes, solid red pom-poms, flowers, thorns, non-red fruit or buried fruit.
Production priority: chunky, readable layered leaf sprays suitable for a few dozen flat cutout twig cards on a short wooden skeleton. Realistic material and natural asymmetric branching; not green noise, not individually rendered thousands of leaves, not a sphere/topiary/lollipop, not an ornamental clipped hedge, not a botanical illustration. Sharp plant detail, real contact shadows, no artificial rim glow, no exaggerated saturation.
```


## 02 — Direction A, foliage and framing refinement

References: `round1/01_direction_a_initial.png` (edit target). `transparent_background: false`.

```text
Use case: precise-object-edit.
Image 1 is the edit target: our original Forkleaf berry bush.
Refine this exact plant study into a final production concept at the largest native resolution available, landscape 3:2. Keep its asymmetric branching identity, small red spherical berries and exposed loose fruit clusters, sparse sandy-grassy ground, realistic maximum-settings game rendering and warm upper-left afternoon light.
Make three closely related foliage/framing corrections: pull the camera framing back enough that the ENTIRE top cluster and every side spray have generous clear margin (about 10% image margin all around the bush); shorten the long pointed leaves to 4-6 cm elliptical leaves with only short pointed tips; give mature leaves a darker, cooler bottle-green body colour with restrained glossy sky reflections instead of yellow-olive colour. Leaf length about five berry diameters. All fruit remains small 0.8-1.2 cm spheres.
The shrub is 1.1 m tall, 1.4 m wide, camera 1.7 m high and about 2.5 m away, clearly looking down over its upper crown and front face. Preserve roughly 30 readable one- or two-stem twig sprays, real holes, shadowed hollows, short multiple woody stems, natural uneven lobes. Increase density only slightly through the central crown so it reads as a rounded shrub, but never fill the gaps into a smooth ball. Berries remain on outer spray tips and outer axils across all faces and crown. No new props, no text, no giant berries, no tree trunk, no topiary, no existing-game references.
```


## 03 — Direction B, initial

References: none. `transparent_background: false`.

```text
Use case: stylized-concept.
Asset type: original realistic survival-game berry bush concept, direction B "Tidebow".
Generate one photorealistic maximum-settings modern survival-game plant study from these words alone. Largest available native resolution, landscape 3:2, no text, no collage.
Scene and framing: one complete bush on plain pale sandy-grassy ground. Standing camera at 1.7 m, about 2.5 m from plant, three-quarter view looking down into crown. Entire plant fits with 10% clear margins. Warm afternoon sun upper left, soft cool skylight in deep leaf hollows, hot humid subtropical coast. Only simple ground behind, no other plants except sparse short grass, no ruins in this close study, no sky or people.
Botanical direction: a squat arching coastal berry shrub 1.0 m high by 1.5 m wide, low short multiple woody stems and irregular rounded mass. Seven older pale brown stems rise obliquely and bow outward under fruit, branching into approximately 32 discrete small twig sprays; leafy arches overlap in three staggered irregular tiers with deep gaps underneath. It is a broad shrub, NOT a fountain of grass, NOT drooping willow foliage and NOT a tree.
Leaves: narrow oblong-lanceolate simple leaves 3-5 cm long, width 1.2-1.8 cm, rounded shoulders and short tapered tips, smooth edges, dark cool blue-green with satin gloss. Alternating leaves in loose spaced groups of 8-12 on a visible stem. Visibly distinct cutout-able twig sprays, not compound fern fronds. Foliage forms chunky separated pockets. One or two yellow-green old leaves, a bitten edge, a bare dead twig, no flowers or thorns.
Fruit habit distinct from terminal cluster plants: tight rounded groups of 7-12 tiny red spheres recur at widely spaced outer nodes along the arching twigs, each group carried below and OUTSIDE the leaf sprays on very short pedicels. Each sphere 0.8-1.0 cm, one fifth of leaf length, pinprick individual gloss highlights. Several groups at each exposed arch, not strings of solitary berries, not enormous grape bunches. About 24 clearly spaced clusters over front, sides and upper crown, leaves between groups. Red is the only saturated non-green/brown colour. Fruit hangs a little under weight.
Art direction: real asymmetric branching, short grounded woody frame visible through open hollows, realistic dark foliage brighter than the berries' shadows, clear fragmented silhouette. A 3D artist must be able to build this with a few dozen flat cutout twig cards; avoid thousands of leaves, noisy green ball, clipped hedge, lollipop, perfect symmetry, oversized berries, decorative red foliage, low camera, illustration or existing-game imitation.
```


## 04 — Direction B, fruit scale and spacing refinement

References: `round1/03_direction_b_initial.png` (edit target). `transparent_background: false`.

```text
Use case: precise-object-edit.
Image 1 is our Tidebow shrub edit target. Keep this exact original plant's overall asymmetric wide arching habit, narrow satin blue-green leaves, short woody multi-stem frame, lighting, sandy-grassy ground and realistic rendering.
Correct FRUIT SCALE AND DISTRIBUTION: the existing berries look like cherries and there are too few per group. Replace each existing fruit group by 10-16 tiny red spherical berries, each exactly HALF the current berry diameter, on delicate short pedicels. A berry must be about one sixth of its adjacent leaf's length, only 0.8-1.0 cm on this 1 m high, 1.5 m wide shrub. Spheres have distinct tiny highlights and visible gaps, not solid blobs. Put additional small spaced groups along the OUTER sides of the arching stems at mid-length nodes, visible outside foliage, so fruit is carried along the bows as well as their ends. Each branch needs leaf-only spaces between its tiny red groups. Keep the sparse interior and whole crown visible.
Framing correction: pull back slightly to leave a comfortable 10% margin around all tips, especially on the left and right. Same standing three-quarter view from eye height 1.7 m about 2.5 m away, looking down into crown. Largest native output resolution, landscape 3:2. No other changes, no text, no flowers, no large fruit, no added background props.
```


## 05 — Direction C, initial

References: none. `transparent_background: false`.

```text
Use case: stylized-concept.
Asset type: original photorealistic survival-game berry shrub concept, direction C "Shellleaf".
Generate one single bush at maximum available native resolution, landscape 3:2, full plant with wide clear margins. Work from these words alone, no reference to existing games, no labels or text.
Setting: simple pale sandy-grassy ground and nothing else. Warm afternoon sunlight from upper left, soft cool skylight inside hollows, realistic humid subtropical coast light. Camera at standing eye height 1.7 m and about 2.5 m away, three-quarter view aimed down over crown and front face. Not low camera. Bush fills 75% image width.
A distinctly BROAD-LEAVED shrub, 1.15 m tall by 1.45 m wide. Several short gnarled grey-brown stems fork near ground, then crooked stocky lateral branches support 26 discrete leathery leaf sprays. Low rounded asymmetric mass with one shoulder higher, uneven shelf-like lobes, leafy lower sides, deep hollows between overlapping sprays, actual background visible through a few holes. No exposed central trunk, no perfect ball or manicured hedge.
Each spray has one or two visible brown twig stems with 7-11 broad SPOON-SHAPED or obovate simple leaves, 5-8 cm long, 3-4 cm wide, smooth rounded tips rather than pointed lanceolate leaves. Leaves dark cool emerald green, thick leathery cupped blades with restrained wax gloss, raised central vein, subtle variation in pitch. Leaves group into readable overlapping fans with clear silhouettes. A few nibbled edges, one yellow-green old leaf, one dead twig. Interior leaves fewer and darker. Clearly buildable as a few dozen flat cut-out twig sprays on a woody frame.
Fruit: small bright red spherical berries ONLY 0.9-1.2 cm in diameter, about one sixth the length of a leaf. Irregular short hanging clusters of 14-24 tiny spheres on branching green-brown stems, compact but with gaps between berries. At least 22 such little clusters spread over outside front, sides, and top crown. Fruit sits OUTSIDE and just below the lip of the leafy sprays; upper crown clusters also protrude past the upper leaves, visible to a player looking down. Each sphere has a small glossy highlight; bunches sag slightly. No big grapes, no cherries, no berries buried in interior. Far more green than red.
Style: a still from a finished high-end modern survival game, physically credible foliage and woody branching, readable broad shapes, crisp natural materials and warm shadows, all our own plant. Avoid uniform leaf noise, thousands of leaves, artificial bloom, excessively saturated foliage, flowers, thorns, ornamental pots, studio pedestal, illustration, collage, people or architecture.
```


## 06 — Direction C, rounded leaf and shelf refinement

References: `round1/05_direction_c_initial.png` (edit target). `transparent_background: false`.

```text
Use case: precise-object-edit.
Image 1 is our original Shellleaf shrub, the edit target. Refine the botanical identity; keep its 1.15 m height and 1.45 m width, short multi-stem base, outside small red berry clusters, sandy-grassy ground, standing camera looking down and warm upper-left afternoon lighting.
Change the leaves distinctly: every mature leaf is a broad obovate SPOON shape with a blunt ROUNDED tip, not pointed, not lanceolate. Smooth edges. Length 5-8 cm and width 3-4 cm. Darker cooler emerald green, thick waxy leathery material with a small soft glossy highlight and restrained veining. Arrange 7-11 such leaves per clearly defined twig spray. Flatten the canopy's visual rhythm into uneven projecting shelves with deep air gaps between the shelves. Lower the single tall peak a little, make the broad right shoulder lower than the left. A rounded squat irregular mass, never geometrically spherical or symmetrical. Roughly 26 distinct cutout-able leafy sprays.
Keep every berry tiny: 0.9-1.2 cm, one sixth leaf length, increase each cluster to 14-24 little separate spherical red berries on branching short stems where needed. Clusters hang just beyond the edges of the foliage shelves, with several crown clusters also exposed above. Gloss highlights on each small berry. No big cherries.
Pull framing back to show clear 10% margins on all four sides around every tip. Landscape 3:2, maximum available native resolution. Crisp finished realistic game render, no labels, no added props, no topiary, no flowers.
```


## 07 — Direction A, 15 m clearing test

References: `direction_a.png` (plant identity reference). `transparent_background: false`.

```text
Use case: compositing.
Image 1 is our original Forkleaf berry shrub design reference. Make a NEW DISTANT CONTEXT VIEW of exactly that plant design, not a closeup. Preserve its stiff forked leafy sprays, dark cool glossy elliptical leaves, irregular rounded waist-high silhouette, short brown multi-stem frame, tiny exposed red terminal berry clusters.
Output: one landscape 3:2 photorealistic finished high-end survival-game screenshot, largest native resolution available, no text, no labels, no UI or character, no existing-game reference.
Camera and scale are critical: standing eye height 1.7 m, normal gameplay perspective about 55 degrees horizontal field of view. The 1.1 m tall, 1.4 m wide berry bush is FIFTEEN METRES from the camera, slightly right of centre, with its base around 62% down the frame. It occupies only about 9% of total image width and 11% of image height. Do NOT enlarge the bush to fill the scene. Its tiny red berries resolve as a scatter of little dots, not giant fruit. Foreground has 10 metres of visible terrain leading to the bush.
Environment: centuries-abandoned warm-bay city, pale weathered limestone and concrete wall ruins at midground, broken asphalt street with sandy cracks, small rubble, unkempt pale grasses, ferns, palmetto fans and sea grape undergrowth. A few palms farther back, a great fig with hanging roots near a ruined arcade, a narrow glimpse of blue bay beyond. Natural layered vegetation, no intact modern buildings or vehicles. Bush grows at the edge of a modest clearing, with grass and green undergrowth adjacent at comparable depth, not on an isolated bare pedestal. Ruined wall behind it should be softly weathered, partially veiled by foliage, not a perfect spotlight backdrop.
Lighting: warm afternoon sun from upper left, soft blue skylight in shadows, hot humid atmosphere. Match the shrub's reference materials. All scene in useful focus as a gameplay visibility test, no portrait bokeh, no vignette, no artificial spotlight or outline on the shrub. The berry bush should draw the eye through its rounded dark glossy mass and outward red berry points among finer, paler, spikier greens. Honest distance scale is more important than displaying individual leaves.
```


## 08 — Direction A, corrected distance scale

References: `round1/07_direction_a_far_overscale.png` (edit target), `direction_a.png` (identity). `transparent_background: false`.

```text
Use case: precise-object-edit.
Image 1 is the edit target: the ruined coastal clearing. Image 2 is the plant identity reference.
Correct ONLY the apparent size and exact design of the one red berry bush at middle-right. Its first render is too large for a 15 m test. Reduce the bush to approximately TWO THIRDS of its current width AND height, anchored at exactly the same ground contact point. In the 1536 x 1024 composition, its total silhouette should be only about 145 pixels wide and 112 pixels high, centred at x=1010 with ground contact y=575. This is a 1.1 m by 1.4 m shrub viewed at 15 m, normal 55 degree horizontal gameplay FOV. Fill the area revealed around it with continuation of the existing grass/background.
Preserve the plant identity from Image 2: rounded scalloped dark glossy cool green foliage made of clear stiff forked twig sprays, five short woody base stems, tiny 1 cm red berry points in exposed irregular terminal clusters across top and sides, deep inter-spray hollows. The lower foliage should cover most of the branch skeleton so it remains a shrub, not a miniature tree.
Keep ALL environment, composition, camera, light, colours, walls, fig, palms, ferns, palmetto and foreground road exactly as Image 1. Do not move anything else or add another bush. Do not brighten or outline the plant. Honest small-scale visibility study, not a hero portrait. Maximum native resolution, 3:2 landscape, no text.
```


## 09 — Direction B, matched 15 m clearing test

References: `direction_a_far.png` (scene edit target), `direction_b.png` (replacement plant). `transparent_background: false`.

```text
Use case: precise-object-edit.
Image 1 is the edit target, a distant coastal clearing visibility test. Image 2 is the replacement plant identity reference, our Tidebow direction B.
Replace ONLY the little red-berry shrub just right of centre in Image 1 with the exact botanical design of Image 2. Keep its ground contact point, intended 15 metre camera distance, 1.7 m eye height, small apparent scale, afternoon lighting, and ALL surrounding environment and image framing unchanged. Landscape 3:2, maximum native resolution.
The replacement bush is 1.0 m tall and 1.5 m across: slightly lower and wider than the existing bush, still only about 11% of frame width and 12% of frame height. Low multiple woody stems support loose asymmetrical arching branches; dark blue-green narrow simple satin-gloss leaves form separate leafy sprays, gaps under the bows. Tiny 0.8-1.0 cm red spheres in little drooping groups of 10-16 occur at spaced exposed nodes along the arches and at their tips. Keep berries outside foliage and visible across the crown and sides, tiny red pinpoints at this distance.
Do not enlarge it for readability, do not make giant berries, do not add a spotlight, do not sharpen it differently from the surroundings. Preserve every wall, tree, road crack, grass bank, fern, palmetto, lighting and camera position from Image 1. No captions, no UI, no extra bushes.
```


## 10 — Direction B, distance size correction

References: `round1/09_direction_b_far_overscale.png` (edit target). `transparent_background: false`.

```text
Use case: precise-object-edit.
Image 1 is the edit target. Make one very local change only: scale the berry shrub down by 22% horizontally and 15% vertically, preserving its ground-contact point. The shrub currently spans roughly x=879 to 1123 pixels; it should span only x=906 to 1096 pixels in this 1536 pixel wide frame. Preserve its arching habit, tiny exposed red berries at spaced nodes, leaves and base. Fill revealed pixels with matching grass. No other changes to the scene. Do not zoom the camera, do not resize the entire image, do not move the shrub. Keep full resolution and 3:2 format.
```


## 11 — Direction C, matched 15 m clearing test

References: `direction_a_far.png` (scene edit target), `direction_c.png` (replacement plant). `transparent_background: false`.

```text
Use case: precise-object-edit.
Image 1 is the edit target, a distant coastal clearing visibility test. Image 2 is the replacement plant identity reference, our Shellleaf direction C.
Replace ONLY the little red-berry shrub just right of centre in Image 1 with the exact botanical design of Image 2. Keep its ground contact point, intended 15 metre camera distance, 1.7 m eye height, small apparent scale, afternoon lighting, and ALL surrounding environment and image framing unchanged. Landscape 3:2, maximum native resolution.
The replacement bush is 1.15 m tall and 1.45 m across, almost the SAME silhouette bounding box as the existing bush: approximately 180 pixels wide and 135 pixels high in the 1536 x 1024 image, centred x=1005 and base y=578. DO NOT exceed that bounding box. Low crooked woody stems support asymmetric overlapping broad leafy shelves. Leaves are broad spoon-shaped, rounded at the tips, smooth-edged, dark cool waxy green, visibly chunkier than the other undergrowth. Distinct spray clusters and deep spaces between shelves. Short pendant bunches of 14-24 tiny 1 cm red spheres project beyond shelf lips, several also exposed over crown. Tiny fruit points at this distance, not giant grapes.
Do not enlarge it for readability, do not add a spotlight, do not sharpen it differently from the surroundings. Preserve every wall, tree, road crack, grass bank, fern, palmetto, lighting and camera position from Image 1. No captions, no UI, no extra bushes.
```


## 12 — Chosen direction A, six berry colours

References: `direction_a.png` (master identity and view). `transparent_background: false`.

```text
Use case: precise-object-edit.
Image 1 is the exact master plant identity and camera reference, our original Forkleaf bush.
Create a clean professional colour-variant comparison sheet at the LARGEST AVAILABLE NATIVE RESOLUTION, very wide panorama 3:1 aspect ratio if supported. ONE SINGLE HORIZONTAL ROW of exactly SIX complete copies of this SAME bush, evenly spaced, no overlapping silhouettes, all bases aligned, all rendered at the same scale and same standing three-quarter camera looking slightly down. Use matching plain sandy ground with sparse grass under each, quiet uncluttered background, and identical warm afternoon light from upper left with soft cool sky fill.
Each specimen preserves the reference's identical branching layout, leaf shape, cool dark bottle-green foliage, leaf gloss, damaged leaves, deep hollow gaps, short woody multi-stem base, crop margin and small spherical berry size. Only change berry surface colour between the six copies. Absolutely do not tint the foliage, stems, ground or lighting.
Left to right berry colours:
1. natural bright ripe RED;
2. rich DEEP BLUE, clearly chromatic cobalt-blue body and blue sky highlights, not black and not pale icy blue;
3. unmistakable VIOLET, cool purple body, not pink or red;
4. golden YELLOW-ORANGE, warm amber-yellow body, not red;
5. NEAR BLACK, charcoal-black body with small natural grey-blue specular highlights, not blue body and not grey fruit;
6. WHITE, creamy pearl white with soft grey shaded side, not flowers.
All berries remain tiny 0.8-1.2 cm spheres on the SAME exposed clusters at tips and along outer sprays, each little sphere its own highlight; no enlargement to compensate for sheet scale, no glow, no giant fruit. Fruit visible over the entire outside and upper crown. Plants all same original 1.1 m tall by 1.4 m across. Do not vary shape or age across this sheet. Photorealistic finished modern survival-game fidelity. Enough negative space above and below, preserve entire plants and ground shadows. No labels, text, borders, legend, people or inset closeups.
```


## 13 — Chosen direction A, three individuals

References: `direction_a.png` (species, material and view reference). `transparent_background: false`.

```text
Use case: stylized-concept.
Image 1 is our original Forkleaf plant's species, materials, leaf-and-berry scale and view reference. Create a production sheet of THREE DIFFERENT INDIVIDUALS of this same species, left to right young compact, mature full, old sprawling. This is variation in natural growth, not recolouring or three identical scaled copies.
Largest available native resolution, wide 3:1 horizontal composition. One row, ample gaps between full silhouettes, common ground plane and consistent physical scale, standing three-quarter view looking down from 1.7 m. All plants red-berried, same plain sandy-grassy ground and warm upper-left afternoon sun with soft sky fill, photorealistic finished modern survival-game fidelity. No labels, text, rulers, people, inset views or props.
LEFT, young compact individual: 0.9 m tall, 1.05 m wide, three slender basal woody stems, around 20 compact forked leafy sprays, slightly more upright shoulders, fewer little berry clusters, short fresh healthy peripheral twigs, tiny cool-green new leaves. Natural asymmetry, not a ball.
CENTRE, mature full individual: 1.1 m tall, 1.4 m wide, closely preserve the source bush identity, five low woody stems, around 30 outward-upward Y-forked sprays arranged into an uneven rounded mass, deep hollows and short woody base. Most abundant red clusters on front, sides and top.
RIGHT, old sprawling individual: 1.05 m tall, 1.6 m wide, thicker gnarled basal wood, one old split low limb and several long lateral branches spreading unevenly, centre opens into a shadowed hollow, lower side reaches outward asymmetrically, several sparse bare twig ends and one naturally dead twig, around 34 spaced leafy sprays with healthy living foliage at their ends. Still alive and fruiting well but less uniformly than mature, not harvested or skeletal.
All three share EXACTLY the same 4-6 cm small glossy smooth elliptical dark cool bottle-green leaves with short pointed tips, 8-14 leaves on one or two twig stems per spray; leaves do not get larger with age. Tiny red spherical berries 0.8-1.2 cm, about one fifth leaf length, 8-18 per loose short branching cluster, visible outside foliage at tips and outer axils all around and above. Fruit spheres retain individual glints, not giant grapes. Woody branching is biologically coherent. A few nibbled and muted yellow-green old leaves.
The mass must stay buildable with a few dozen cutout leaf-spray cards on a short woody frame: separated silhouette clumps, actual air gaps, darker sparse inner foliage, never green noise or sculpted topiary. Keep leaves and fruit the same physical dimensions on every individual and maintain enough margin around every plant.
```


## 14 — Individuals, standing-camera correction

References: `round1/13_individuals_low_camera.png` (edit target), `direction_a.png` (camera and species reference). `transparent_background: false`.

```text
Use case: precise-object-edit.
Image 1 is the edit target, our three Forkleaf age variants. Image 2 is the correct camera-angle and ground reference.
Preserve the three individuals' distinct natural branch structures and left-to-right young / mature / old order from Image 1, but correct the camera to MATCH Image 2: standing viewer looking DOWN at each bush, about 25 degrees downward, so the upper surfaces of the foliage crown and the ground behind are plainly visible. There must be NO SKY AND NO HORIZON anywhere; the entire background is the same plain sandy-grassy ground receding behind the plants. This is a row of three matched 2.5 m plant-study views, not a camera at shrub height. Warm upper-left afternoon light and soft cool sky fill remain.
Keep all three entire plants in the wide 3:1 sheet with gaps and common ground line. Young left is 0.9 m high by 1.05 m wide: make it a little broader and compact, wider than tall, rather than thin and upright. Mature middle remains 1.1 m by 1.4 m and matches Image 2. Old right remains 1.05 m by 1.6 m with its long low lateral limb and split gnarled base.
Keep identical species botany and berry scale across all three: small 4-6 cm glossy cool bottle-green elliptical leaves, small 0.8-1.2 cm red spheres in external loose clusters, leaf sprays on forked twigs, visible inter-spray holes. No bigger berries or larger leaves, no labels, no new props. Maximum available native resolution, photorealistic finished modern game fidelity.
```


## 15 — Chosen direction A, picked clean

References: `direction_a.png` (same-individual edit target). `transparent_background: false`.

```text
Use case: precise-object-edit.
Image 1 is the EXACT edit target, our mature Forkleaf berry shrub. Paint this SAME individual immediately after a survivor has stripped it by hand for berries and fibre.
Preserve camera, framing, plant position, the identifiable five woody basal stems, main branch layout, ground and warm upper-left afternoon lighting exactly. Same 1.1 m high by 1.4 m across bush seen from 1.7 m eye height at 2.5 m in three-quarter view. Full plant and comfortable margins, largest native resolution, landscape 3:2.
Harvest changes:
- Remove EVERY berry from the whole plant, including crown, rear silhouettes and interior, and leave no berries on the ground. No red dots anywhere.
- About 40 percent of the leaves are torn away, predominantly at easily reached outer tips and middle-front sprays. Retain the inner living dark-green foliage and original glossy elliptical leaf identity so it is clearly alive, not a dead winter shrub.
- Expose stripped twig lengths and tiny empty fruit pedicels where clusters were, several rough snapped-off terminal tips with pale fresh wood. Not clean garden-pruning cuts.
- Three outer sprays have been bent/snapped by hand and hang sharply downward from partially attached splintered stems, with some fresh green leaves still on them. Make the collapsed upper-right and front-left silhouette changes clearly readable.
- Remaining leaves include a few torn or creased blades, irregular fresh gaps, uneven ragged canopy. Preserve enough leaf mass to recognize the same bush, but visibly raided.
- A small scattering of about ten fresh detached green leaves and one complete broken leafy spray lies on the sand immediately under and in front of the bush. Natural modest debris, not a giant pile.
This must read instantly as harvested and physically damaged, not simply a healthy berryless copy or a dead skeleton. Photorealistic modern game materials, real contact shadows. No people, tools, text, arrows, inset panels, berries, flowers, added props or dramatic lighting change.
```


## 16 — Chosen direction A, steep overhead view

References: `direction_a.png` (same-individual identity). `transparent_background: false`.

```text
Use case: stylized-concept.
Image 1 is our original mature Forkleaf berry bush, the plant identity reference.
Create a new view of this SAME unharvested red-berry plant from steeply ABOVE, as seen by a standing player leaning over the shrub. Camera looks downward at roughly 65-75 degrees below horizontal, close to top-down but still slightly oblique, seeing the whole upper crown with only a little of the front side. Do not reuse the original front view. No feet, hands, person or UI. One whole bush, 3:2 landscape, largest available native resolution, comfortable margin around all leaves, plain sandy-grassy ground all around, no horizon.
Preserve its 1.1 m height and 1.4 m width, asymmetrical softly five-lobed rounded outline, roughly 30 distinct stiff outward-upward forked twig sprays, short woody multi-stem structure seen only through a few dark holes. Same small 4-6 cm elliptical cool bottle-green glossy leaves, short pointed tips, 8-14 leaves per spray, natural leaf angles and readable silhouettes. Warm afternoon sun upper left, soft blue skylight in hollows, subtle translucency, some bite damage and a muted yellow-green old leaf, real shadows.
CRITICAL gameplay test: tiny red spherical 0.8-1.2 cm berries in loose irregular clusters of 8-18 must be exposed on the UPPER CROWN as well as on perimeter sprays. Distribute about 12 clearly visible clusters across the top surface at different radii, plus perimeter clusters. Clusters emerge beyond leaves on short branching pedicels and droop slightly; leaves do not bury the fruit. Not a peripheral ring around a fruitless centre, not giant berries. Each sphere has a tiny individual gloss point. Far more green than red.
Show how overlapping cutout-able leafy sprays form the upper canopy: clear larger leaf pockets and genuine dark recessed gaps, not a flat green texture disk or topiary. This should be buildable from a few dozen twig cards on a short woody frame. Match original realistic finished high-end game rendering and materials. No flowers, fruit of other colours, added objects, labels or insets.
```


## 17 — Chosen direction A, flat fruiting twig

References: `direction_a.png` (species and material reference). `transparent_background: false`.

```text
Use case: stylized-concept.
Image 1 is the species and material reference: our original Forkleaf bush. Create ONE practical leafy twig-card source study from this exact species, laid FLAT and seen STRAIGHT ON, isolated against perfectly uniform neutral middle grey (#808080). This is a 3D foliage artist's cutout reference. Largest available native resolution, square composition. No text, no labels, no rulers, no other objects or ground.
The specimen is ONE modest asymmetrical leafy spray about 25 cm long and 20 cm wide: a single thin brown woody twig rising diagonally from lower centre, forking naturally into TWO little stems; 12 small simple elliptical leaves attached by visible short petioles in an alternating arrangement, 4-6 cm long, smooth edges, short pointed tips. Match the master bush's dark cool bottle-green mature foliage, waxy glossy upper surfaces, gently cupped blades with subtle midrib and fine subordinate veins. One leaf has a small natural bite notch, one small muted yellow-green older leaf, otherwise healthy. Readable clear outer silhouette, irregular gaps between leaves, limited overlaps. Most leaf blades face the camera enough for a usable flat texture; no edge-on bundle, no bouquet, no trunk or giant branch.
ONE terminal berry cluster at the upper-right fork: 16-20 little ripe RED spherical berries on delicate green-brown branching pedicels, distinct spheres and readable stem attachments. Each berry 0.8-1.2 cm, about ONE FIFTH of the average leaf length. Short loose cluster leans slightly down under weight, positioned outside and beyond the leaves so every fruit silhouette reads. Not a heavy grape bunch, no giant cherries, no other colours.
Lighting and material: photorealistic high-end game-asset fidelity, warm soft key from upper left and cool broad sky fill, restrained natural highlights on leaves and a tiny individual highlight on each berry. Preserve volume but only minimal contact shadow very close to the specimen; no broad cast shadow, no vignette, no gradient, no noise in the grey background. The whole twig, cut base, leaves, pedicels and fruit visible with generous clean 12% margin, no crop. Flattened botanical placement, orthographic straight-on camera, not perspective tabletop photography.
```


## 18 — Matched twig, berries picked off

References: `twig.png` (exact edit target). `transparent_background: false`.

```text
Use case: precise-object-edit.
Image 1 is the exact edit target: our flat Forkleaf twig cutout reference.
Remove ONLY ALL the red berries from the terminal cluster. Keep the now-empty branching fruit pedicels with tiny torn attachment scars at their tips, so it is recognizably the same cluster after the berries have been picked off. No berries remain anywhere and no detached fruit is shown.
Preserve EVERY OTHER DETAIL of Image 1 as closely as possible: exactly the same twig fork and stem position, the same 12 leaves in the same locations and orientations, same leaf sizes, bite notch, yellow-green older leaf, bark, cut base, material, colour, lighting, framing, square canvas, and perfectly plain neutral middle-grey background. No extra leaf loss in this reference; this is specifically a matched fruit-on/fruit-off twig pair. Do not reshape the plant, do not move the pedicels, do not change the camera or zoom.
Largest available native resolution, same full specimen and margins, orthographic straight-on flat arrangement, crisp photorealistic game-asset material study, minimal contact shadow, no text or added objects.
```


## Output index

The filenames below identify the unchanged native PNG returned for each numbered call. All calls used `transparent_background: false`; image references were passed through `referenced_image_paths` when listed above. There were no unrecorded generation calls or image-processing edits.

| Call | Saved output | Decision |
| --- | --- | --- |
| 01 | `round1/01_direction_a_initial.png` | Superseded |
| 02 | `direction_a.png` | Selected |
| 03 | `round1/03_direction_b_initial.png` | Superseded |
| 04 | `direction_b.png` | Selected |
| 05 | `round1/05_direction_c_initial.png` | Superseded |
| 06 | `direction_c.png` | Selected |
| 07 | `round1/07_direction_a_far_overscale.png` | Superseded |
| 08 | `direction_a_far.png` | Selected |
| 09 | `round1/09_direction_b_far_overscale.png` | Superseded |
| 10 | `direction_b_far.png` | Selected |
| 11 | `direction_c_far.png` | Selected |
| 12 | `colours.png` | Selected |
| 13 | `round1/13_individuals_low_camera.png` | Superseded |
| 14 | `individuals.png` | Selected |
| 15 | `picked.png` | Selected |
| 16 | `above.png` | Selected |
| 17 | `twig.png` | Selected |
| 18 | `twig_picked.png` | Selected |
