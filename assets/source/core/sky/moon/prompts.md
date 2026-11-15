# Moon generation prompts

All image calls use the built-in image generator. No lunar photograph, map, or reference pixels were passed to it. Coordinate guidance is textual.

Outputs are preserved unmodified as `originals/round-01.png`, `originals/round-02.png`, etc. Finishing is reproducible in `scripts/build_moon.py`.

## Round 1: initial painting

Mode: new generation. `transparent_background: true`. No image inputs.

```text
Use case: stylized-concept
Asset type: hand-painted full Moon albedo sprite for the luminous night sky of an original survival game on post-human Earth, tropical coasts and jungle. It will appear only 32–64 pixels wide in play, but the source must reward inspection at 512 pixels.
Primary request: paint Earth's recognizable near-side full Moon, north up, with correct broad lunar geography. This is a finished game painting, NOT a photograph, telescope image, realistic 3D render or random fantasy planet. No image references are supplied. Use your knowledge of the Moon.
Composition: one perfect circular disc, centered in a square, occupying 90 percent of the width and height with a small transparent margin. Genuine transparent background. Nothing outside the disc. No stars or text.
Geography: the great broad Mare Imbrium basin is upper-left of center, joined to sprawling Oceanus Procellarum along the left half. Mare Serenitatis is a rounded sea upper-right of center, touching the irregular Mare Tranquillitatis below-right. Mare Crisium is the distinct isolated oval near the upper-right edge, separated by bright highlands. Fecunditatis lies southeast of Tranquillitatis, and smaller Nectaris below it. Nubium and Humorum make smaller subdued grey seas in the lower-left. Frigoris is a narrow grey irregular band near the northern edge. The lower half and right-side highlands are mostly bright. Do not invent large additional dark basins.
For positions on the disc itself (left=0, top=0, right=1, bottom=1): Imbrium centered approximately (0.34,0.24); Serenitatis (0.64,0.28); Tranquillitatis (0.72,0.43); Crisium (0.90,0.36); Nubium (0.36,0.68); Humorum (0.22,0.70). Small Copernicus centered (0.33,0.42) with a soft irregular pale ejecta fan. Small Tycho centered (0.43,0.83) with a few long, broken, wispy ivory rays across the southern highlands, lightly tapering upward. These are small accents, not giant bullseyes or star icons.
Style/medium: sophisticated hand-painted game sky art in opaque gouache with subtle dry-brush edges and broad, confident overlapping tonal strokes. Quiet faceted paint marks, beautifully controlled lost-and-found edges within the surface. Broad maria silhouette first, medium brushwork second, sparse fine crater suggestion third. Recognizably authored and painterly when enlarged, but calm and readable in miniature. The maria should be softly modulated middle-light warm grey, not charcoal or dark stains; brighter pale highlands. Subtle cool pearl grey and warm ivory shifts, very close to neutral. A touch of luminous fantasy-sky elegance without glow.
Lighting: FULL FACE UNLIT ALBEDO, completely even brightness from center to the entire rim. All parts of the circumference stay bright. No light direction, no terminator, no cast shadows, no shaded rim, no spherical lighting gradient, no bright rim outline, no bevel. Craters are suggested by pale mineral marks and interrupted rings, never deeply shadowed holes.
Avoid: photorealistic pitted noise, photographic sharpening, black patches, dirty speckles, cloud textures, mottled grime, uniform procedural cratering, thick impasto relief, literal canvas grain, saturated blue, orange, luminous halo, bloom, atmosphere, external glow, drop shadow, a human face, labels, border, watermark.
```

## Round 2: integrate the brushwork and refine the rays

Mode: edit. `transparent_background: true`. Input: `originals/round-01.png` only.

```text
Use case: precise-object-edit
Asset type: painted full Moon albedo sprite for a game.
Input image: Image 1 is the original generated painting to refine. It is the ONLY image input; no lunar photographs are supplied.
Primary request: refine the surface painting so the familiar lunar face feels more natural and art-directed, less like a collection of separate flat paint patches. Preserve the composition, north-up orientation, feature centers, circular full disc, transparency, overall brightness, and restrained contrast. Keep this a beautiful handmade game painting, never photographic.
The upper-left Imbrium and west-side Procellarum must read as a broad connected system with nuanced irregular shorelines. The upper-right Serenitatis and the Tranquillitatis below it must have recognizably different shapes: Serenitatis rounder and slightly smaller, Tranquillitatis irregular and branching. Keep isolated Crisium near the upper-right rim. Keep Nubium and Humorum lower-left, the bright sweeping southern and eastern highlands, and the small Tycho and Copernicus ray craters in their existing positions.
The targeted change is the quality and integration of the painted marks: replace the repetitive chunky scalloped patch edges with a mixture of soft transitions, crisp small broken ridges, subtle overlapping scumbles, and lost-and-found contours. Make the northern Frigoris band narrower and calmer. Introduce finely observed painterly mineral detail within the big seas, with only very slight value variation, so they are not flat brush-filled shapes. Avoid new dark patches or holes. Let the southern highlands have quiet angular brush planes, a few delicate interrupted crater arcs and dry-brush stippling, with ample resting areas. The main hand of the painting should be medium-sized, confident, variable brushwork, with occasional fine accents, not photographic noise and not generic clouds.
Make Tycho's ray fan finer, more broken, asymmetric and delicate; avoid a regular starburst. Copernicus should be a modest silvery accent integrated into the western maria, not a large white flower. Keep both small crater centers. These are mineral ejecta markings, not external lighting.
Color: almost neutral pearl grey and pale ivory; reduce the original's ochre tint. Maria should remain gentle medium-light greys. The Moon should stay calm, luminous, and readable when reduced to 40 pixels. No extra global darkening.
Critical invariants: completely evenly illuminated full-face ALBEDO, no directional shading, no shadowed limb, no spherical brightness falloff, no terminator, no crater cast shadows, no bright border outline, no halo, no glow. Entire rim bright. One disc only, clean transparent background, nothing outside it. No text or labels.
```
## Round 3: correct the mare shorelines

Mode: edit. `transparent_background: true`. Input: `originals/round-02.png` only.

```text
Use case: precise-object-edit
Input image: Image 1 is my generated game Moon painting, the only reference. No photograph is supplied.
Refine the SHAPES OF THE LUNAR SEAS in this painting. Keep every feature in its existing position; keep the circular north-up Moon, near-neutral colour, transparent background, subtle painted surface, small Copernicus and Tycho with their delicate rays, and the even fully lit face.
The current grey seas look too much like neatly separated round islands with white outlines. Fix this particularly in the lower-left: Mare Nubium, the grey area just left and below center, must be a branching irregular bay with a ragged eastern edge and grey arms extending northward into the western plains, NOT a closed circular spot. The smaller Mare Humorum to its left can remain roughly oval, but lose the complete thick pale outline around it. Remove the extra dark little circular spot directly below Humorum; make it part of the subtle pale southern highland texture.
At upper-left, let Imbrium open naturally into broad Procellarum on its southwest, with wispy, irregular, partly lost boundaries. At upper-right keep Serenitatis rounder, but make Tranquillitatis just below it a less evenly rounded branching shape extending to the east, with varying grey values and a few slender highland interruptions. Keep the isolated oval Crisium near the upper-right edge clearly separate. Break the continuous bright channels between the maria so some edges dissolve gently into halftones and some small ridge sections remain crisp.
Maintain a hierarchy of broad, quiet recognisable shapes, elegant medium-scale hand-painted strokes and sparse delicate details. This is a mature gouache game-sky painting, not a diagram, decorative pattern, photograph or 3D render. Vary the direction and scale of brush marks; no global diagonal scratch texture. Fine accents should describe geology, not random dots.
Brightness: luminous chalk-pearl highlands and gentle silver-grey seas; gently lift the overall lightness a little. No charcoal anywhere. The tiny 40-pixel version must look calm and recognisably like Earth's Moon.
ALBEDO ONLY: no shading at the rim, no radial shading gradient, no light direction, no dark crater shadows, no bevel, no halo, no external glow. Preserve a bright full face all the way around. Exact circular disc with true transparent exterior; no scattered paint flecks outside, no text.
```

## Round 4: round-two repaint of values, shores and full-sun marks

Mode: edit. Built-in image generator. `transparent_background: true`. Input: `originals/round-03.png` only. Output: `originals/round-04.png` (raw, unchanged).

```text
Use case: precise-object-edit
Asset type: hand-painted full Moon albedo sprite for a survival game's night sky, judged at only 32 and 48 pixels, and also at 512.
Input image 1 is the previous generated painting. Use it ONLY for broad lunar geography and north-up orientation. Thoroughly REPAINT its surface to correct all four problems below. The existing pale colours, jagged outlines, crater rings and straight ray lines are defects to replace, not details to preserve. No photographs are supplied or wanted.

1. VALUE STRUCTURE: the familiar dark face must read immediately at 32 pixels. Paint the seas as strong middle-dark cool greys, roughly sRGB 125–155, against clean pale ivory highlands around 220–238. Broad connected sea shapes are the first thing one sees. No black, no dirt, no artificial outline. Preserve calm by simplifying the interiors, NOT by bleaching out the contrast. Very restrained warmth in highlands and coolness in seas; overall close to neutral grey.
2. SEA SHAPES: replace all the torn, fragmented lace boundaries with broad, softly painted, gently irregular pools. Smooth the medium-scale contour, fill the little white holes and islands, join Imbrium naturally into Procellarum, and connect Serenitatis into Tranquillitatis through its neck. Preserve Imbrium's broad rounded northern curve, rounded Serenitatis and separate oval Crisium. The seas are calm lava plains with a few broad low-contrast tonal washes and barely suggested wrinkles, not busy hatching or diagonal brush scratches. Keep recognisable geography: upper-left Imbrium, west Procellarum; upper-right Serenitatis above Tranquillitatis; isolated Crisium near upper-right rim; Fecunditatis and Nectaris southeast; Nubium and Humorum lower-left; narrow subdued Frigoris north. Preserve a bright rim to the edge.
3. CRATER EJECTA: completely ERASE the old ringed Tycho and Copernicus and ALL their straight spokes. Repaint Tycho at about (0.43,0.83) within the disc as a tiny irregular bright ivory fleck on a subtle slightly greyer collar. Around it, glaze long, very faint, uneven soft-edged mineral wisps over the south and northward into the seas. Variable widths, broken lengths, partly lost in the highlands; asymmetric painterly light smears. NO geometric rays, NO star shape, NO thin drawn lines, NO hub-and-spokes. Copernicus at about (0.33,0.42) is a small irregular bright patch with a much shorter diffuse pale splash surrounding it, with no visible rim or hole.
4. FULL-SUN SURFACE: erase EVERY circular crater ring across the surface, including at the poles and eastern edge. No shadowed pits, no cups, no donuts, no engraved outlines or relief. Replace them with very fine understated painted mineral mottling, a few pale fuzzy flecks and tiny young-crater highlights. Mostly quiet southern highland ground.

Medium: an elegant carefully observed gouache game painting. Use subtle organic paint variation and broad confident soft-edged strokes, with fine pale scumbling only in highlands. Painted, not photographic, not a 3D render, not vector shapes, not decorative iconography. No literal canvas grain or global diagonal scratches.
Format invariants: ONE circular north-up FULL Moon disc, centered in a square, almost filling it with a small transparent margin. Fully opaque interior, genuinely transparent exterior, clean circular silhouette. Even full-face albedo, bright all the way to the rim, no lighting direction, no radial falloff, no terminator, no shading gradient, no bright border, no halo, no glow, no exterior marks. No text.
```

## Round 5: quiet highland paint and irregular ejecta

Mode: edit. Built-in image generator. `transparent_background: true`. Input: `originals/round-04.png` only. Output: `originals/round-05.png` (raw, unchanged).

```text
Use case: precise-object-edit
Input image 1: my revised painted full-Moon sprite, the only image reference. No photographs.
Keep its north-up lunar geography, broad dark sea shapes and their smoother shorelines, clean round full-face silhouette, transparent outside, and new absence of ringed craters. The contrast must remain strong enough for the lunar face to read at 32 pixels: cool middle-dark grey seas against clean ivory highlands. Do not lighten the seas.
Make one finishing pass on the SURFACE MARKS. The present highlands have too much broad cloudy diagonal streaking; calm that into a clean pale ivory ground with delicately varied hand-painted fine mineral mottling and soft scumbles, while the dark seas become smoother quieter pools. Vary the tiny brush marks rather than covering everything with uniform diagonal scratches. This should reward close inspection at 512 pixels as a deliberate gouache painting, never a photograph.
Make the two ejecta accents exquisite and understated: Tycho, the tiny bright spot low in the southern highlands, has a small irregular ivory core within its existing faint grey collar, not a star, not a ring. Its ejecta is a handful of very faint diffuse uneven long wisps crossing the southern ground and reaching into the left seas, each broken, different in width and length, merging into the pale ground. Lose the organized radial fan. Some streaks should be almost invisible. Copernicus, the spot left of centre amid the western seas, is a little bright paint splash with a softer shorter hazy spray, no radiating lines, no ring, no raised rim. Keep both small and natural.
Leave plenty of restful smooth sea floors and pale highland ground. Broad connected maria silhouettes still dominate before paint detail. Keep Imbrium's northern curve, Serenitatis's rounded basin, isolated Crisium, and lower-left Nubium/Humorum exactly where they are. No new dark spots or new basins.
Critical invariants: genuinely transparent exterior, fully opaque interior, single centered circular disc almost filling the square. Evenly lit FULL Moon ALBEDO, no phase or lighting direction, no shaded limb, no bright outlined rim, no gradient toward the edge, no halo or glow, no craters drawn as rings or holes, no sun-icon spokes, no text. Restrained slightly warm ivory and cool grey palette, overall near neutral. Preserve clarity and contrast; preserve painting style.
```

## Round 6: distinct sea paint and natural shores (delivery round three)

Mode: edit. Built-in image generator. `transparent_background: true`. Input: `originals/round-05.png` only. Output: `originals/round-06.png` (raw, unchanged).

```text
Use case: precise-object-edit
Input image 1 is the edit target: our own painted Moon sprite. No photographic input.
Task: repaint the MARIA (dark seas) and their shorelines so this becomes a rich, carefully observed gouache painting at 512 pixels. Preserve the instantly recognizable lunar face and its dark-sea / pale-highland value separation at 32 pixels. Preserve positions, sizes, connections and north-up orientation of all principal seas. Preserve the pale quiet southern highlands and the two small crater locations for a later pass.
The existing seas all have the same flat grey filling and cartoon-cloud scalloped contours. Replace this flat filling with nuanced, restrained paint and give each sea its own character:
- Serenitatis, the round basin upper right of centre: a softly paler grey interior with a subtly darker, irregular margin, still much darker than the highlands. A natural lava basin, not a circle with an outlined ring.
- Tranquillitatis below it: a little deeper and cooler, with broad gently overlapping mineral-grey tones.
- Imbrium upper left: a darker floor, crossed by a few quiet lighter uneven brush streaks that are part of the paint, with a well-held curved northern basin edge.
- Procellarum at left: a broad connected mottled plain, different grey washes and soft scumbles. Along its WEST/left edge, grey paint gradually mingles and fades into pale highlands in a broad irregular transition, rather than a cloud silhouette.
- Crisium remains separate and rounded at far upper right, a deeper basin with a gently varied floor. Nubium and Humorum remain in their existing lower-left positions, calm but differently toned.
Edges: replace repeated rounded lobes with natural long shoreline gestures, mixed lost-and-found edges. A few basin-rim boundaries are definite and curved; most shores are soft, irregular and locally ragged. No cookie-cutter shapes, no scallops, no outline strokes, no torn lace or fields of small bright islands.
Texture: subtle broad layered brushwork in sea interiors, modest changes of tone, a few very fine streaks. The seas remain smooth lava plains, not craters or rock relief. Every sea must retain a dark average against pale highlands. Do not make the whole Moon cloudy or dirty. Keep the highlands a calm luminous ivory ground with their current quiet fine mottling. Paint by hand in a sophisticated game-art gouache style, not a photograph, vector graphic or airbrushed diagram.
Invariants: one FULL north-up circular Moon, bright to the very edge, no radial lighting gradient, no side light, no terminator, no crater rings, no black pits, no halo, no glow, no text. Tiny existing crater highlights only. Grey palette with restrained ivory highlands and cool grey seas. Fully opaque disc, genuinely transparent exterior, centered in a square with a small transparent margin. Preserve the successful dark face at a glance.
```

## Round 7: Tycho rays, Copernicus splash and quieter eastern seas

Mode: edit. Built-in image generator. `transparent_background: true`. Input: `originals/round-06.png` only. Output: `originals/round-07.png` (raw, unchanged).

```text
Use case: precise-object-edit
Input image 1: our painted Moon, edit target. Preserve its geography, dark connected seas, distinct basin tones, softened western shore, round silhouette, quiet highlands and strong small-size face.
Paint a careful final ejecta pass. TYCHO MUST NOW HAVE VISIBLE LONG RAYS. It is the tiny white spot in the SOUTH at about (0.41, 0.84) of the disc. Keep its small irregular bright core and subtle grey collar, no circle or ring. From this location paint a sparse asymmetric network of soft, elongated streaks of pale ejecta, lower in brightness than the crater. A few must reach a long way: upward and upper-left ACROSS NUBIUM and into the western dark plain, one long narrow oblique wisp northeast across the bright southern ground, with shorter interrupted light veils south and east. These are lightly dragged, broken washes of pigment with uneven widths, feathery edges and variable opacity, some merging with the ground and reappearing. The rays should be clearly discoverable at 512 pixels, not erased into invisibility. On dark lava floors they are modest lighter grey veils, never white drawn lines. Near Tycho, overlapping softly luminous paint rather than an organized fan. No straight spokes, no equally spaced radiating lines, no geometric starburst.
COPERNICUS, the bright point in the western grey field at about (0.32,0.42), is currently a sharp sparkle. Repaint it as a small irregular bright splash of ivory with a diffuse, wider asymmetric spray around it. Remove the pointed star shape. Soft broken powdery paint spreads out into the grey at varying distances; no crater ring, no pin-sharp spikes. Keep it small relative to the face. No need to add other craters.
One subordinate refinement to the new sea paint: keep Imbrium's lighter streaks, but soften the matching diagonal bands in Tranquillitatis and the smaller southeastern seas into subtle irregular blended variations. Their interiors should be quiet, gently variegated, not slashed with parallel bands. Preserve Serenitatis's paler middle and darker margin, preserve its dark separation from the highlands, and preserve the west's soft lost edges. Avoid repeated scallops on shorelines.
The painting should reward a 512px look but read instantly at 32px: broad dark seas first, calm pale ground second, restrained rays third. Do not lighten the seas as a whole. Do not dirty the highlands, add crater rings, dark holes, global scratches or topographic shadows.
All format invariants: north-up FULL face, circular centered disc in square with narrow transparent margin, fully opaque interior, genuinely transparent exterior. Bright all the way to the rim with no limb shading, no side light, no phase, no halo, no glow, no outlined rim. Near-grey cool maria and pale ivory highlands. Gouache game painting, not photograph, not vector, no text.
```

## Round 8: reduce ray density without losing the long streaks

Mode: edit. Built-in image generator. `transparent_background: true`. Input: `originals/round-07.png` only. Output: `originals/round-08.png` (raw, unchanged).

```text
Use case: precise-object-edit
Input 1 is our own painted full Moon sprite. Make ONLY a restrained refinement to the crater ejecta; keep all seas, their paint variation, their tones and shorelines, their geography and the bright rim unchanged.
TYCHO near (0.41,0.84) of the disc: the previous edit made too many bold rays, turning the southern ground into a bright spiderweb. Repaint the southern ground so it is calm again. Remove roughly two-thirds of the current short southern/eastern rays entirely, restoring pale mottled highland underneath. Preserve just a sparse, asymmetric set of unequal streaks. Keep TWO long northwestern rays visible crossing Nubium and continuing into the western maria, and ONE long, very soft northeastward wisp crossing the southern highlands, plus a few barely perceptible shorter traces. Reduce the surviving streaks' brightness/contrast by about half, soften and widen their edges, break their continuity with lost sections. These long rays must remain visible at 512 but must be fainter than the tiny bright crater. The rays are diffuse veils of lighter paint, not white threads or outlined tendrils. No ring around Tycho. Its little irregular ivory core is the brightest small mark in the south, within a subtle grey collar, and has a soft short local splash. No regular radial fan, no star spikes. Preserve several long rays rather than erasing ALL ejecta.
COPERNICUS at (0.32,0.42): retain its small irregular bright core but soften any pointed star tips into a compact uneven splash with a subdued diffuse dusty spray. No sharp sparkle, no ring.
Keep everything else: darker Imbrium with lighter streaks, pale-centred Serenitatis with darker boundary, deeper cool Tranquillitatis, softly mottled western Procellarum fading into highlands, isolated Crisium, correct existing sea silhouettes and clear sea/highland contrast at 32 pixels. Quiet highland paint. Sophisticated restrained gouache painting, not photo or icon.
Format: single north-up circular FULL Moon in a square, narrow transparent margin, genuinely transparent outside, fully opaque inside. Bright right to the edge, no dark limb or lighting gradient, no phase or side light, no halo, no glow, no text, no crater rings or shadowed pits. Near-grey palette.
```

## Round 9: replace remaining cloud-like shoreline lobes

Mode: edit. Built-in image generator. `transparent_background: true`. Input: `originals/round-08.png` only. **Attempt failed**: HTTP 401 `token_revoked` (invalidated OAuth token). No output image was produced and no `round-09.png` exists. The selected source remains `originals/round-08.png`. No CLI/API fallback was used.

```text
Use case: precise-object-edit
Input image 1: our painted full Moon, the edit target.
Make a strictly LOCAL shoreline refinement. Everything away from shorelines stays as painted: sea tones and interior texture, pale Serenitatis centre, Imbrium streaks, calm ivory highlands, Copernicus bright soft splash, Tycho small bright core and its few long faint rays across Nubium and the southern ground.
The remaining defect is the repetitive rounded scallops around the dark seas, especially Tranquillitatis (large dark sea right of centre), the smaller southeastern seas, the eastern edge of Imbrium and the central western plain. Their outlines still look like cartoon clouds. REPLACE the repeated little convex lobes, knobs and rounded bites with a few longer asymmetrical shoreline gestures, some straighter oblique sections, shallow irregular bays, and locally broken soft feathering. Keep the overall boundary position, area and silhouette of each sea nearly the same so the lunar face is unchanged at 32 pixels. Do not expand, shrink, rearrange or add a sea. Do not change the layout or number of basins.
Use painterly LOST-AND-FOUND edges. Along selected portions, gently drag the grey paint into the pale ground so the boundary dissolves over a narrow irregular band; elsewhere let the basin's edge be firm. Not a consistent blur around every outline. No outline or rim stripe. No rounded cloud puffs, no uniform scalloped border, no torn lace or scattered pale islands.
Keep Serenitatis and Crisium as rounded natural basins, with their existing tones, no drawn ring. Keep Procellarum's already-soft west boundary and all fine paint within the plains unchanged. Avoid sharpening or outlining any sea.
Preserve the successful dark-sea and bright-highland separation, the long faint Tycho rays and Copernicus diffuse spray. Restrained sophisticated gouache game painting, not a photograph.
All format invariants: one circular north-up FULL Moon, centered in square with small transparent margin, truly transparent outside, fully opaque inside, pale all the way to the rim, no side lighting, no radial darkening, no phase, no halo, no external glow, no text, no shadowed crater rings. Overall near grey.
```


## Round four: edit 1: eastern shorelines

Mode: built-in image edit. Input: `originals/round-08.png`. Transparent background. Prompt is recorded in `iterations/round-11-shores/prompt.txt`.

Output: `originals/round-09.png` (raw, unchanged).

```text
Use case: precise-object-edit
Asset type: painted full Moon sprite for a game's night sky.
Input image 1: edit target, our existing painting. This is a final surgical correction, not a new moon.
Change ONLY the outlines of the five eastern seas in the right half of the image: Serenitatis (large pale-centered basin above right of centre), Tranquillitatis (dark sea immediately below it), Fecunditatis (lower far right), Nectaris (small lower-right sea), and Crisium (isolated small basin at far upper right).
Their current boundaries are made of repeated rounded lobes, like cartoon clouds. Completely remove that scalloping. Serenitatis must become a near-circular basin with one continuous gently curving boundary, preserving its pale heart and darker margin. Crisium must be a clean near-oval with one continuous curved boundary, no little round protrusions or bites. These edges have a narrow soft paint transition, not an outline. Tranquillitatis, Fecunditatis and Nectaris need a few long asymmetrical smooth shoreline gestures and shallow angular bays, with soft lost-and-found sections where lava thins. NO rows of circular bumps, NO crenellations, NO torn lace, NO repeated rounded little peninsulas. Preserve their overall locations, extent, area and tonal separation, so the moon's face remains the same at 32 pixels.
Keep the paint inside the seas, especially Serenitatis's luminous pale grey heart and Tranquillitatis's deeper cool grey. Keep the entire left half unchanged: mottled streaky Procellarum fading west, Imbrium's existing tones, and Copernicus splash. Keep Tycho and its existing rays, all highland textures, full-disc colour and brightness unchanged.
Style: restrained gouache game painting, near-neutral grey with slightly warm pale highlands. No photographic texture.
Format invariants: one circular north-up FULL Moon, centered in square with a small transparent margin, truly transparent outside and opaque inside; pale to the rim, no directional illumination, no limb darkening, no phase, no glow or halo, no text, no crater rings.
```

## Round four: edit 2: lost-and-found southeastern shores

Mode: built-in image edit. Input: `originals/round-09.png`. Transparent background.

```text
Use case: precise-object-edit
Asset type: painted full Moon game sprite.
Input image 1 is the edit target, our current painting. Preserve this painting, with one small localized refinement.
The eastern basin shapes are now correct: Serenitatis at upper right has a continuous near-round edge and pale heart; Crisium at far right is a clean oval. KEEP THEM EXACTLY AS THEY ARE.
Change only selected shoreline stretches of the three seas BELOW Serenitatis: Tranquillitatis (large dark sea right of centre), Fecunditatis (lower far right), Nectaris (small sea below centre-right). Their new silhouettes are good but are uniformly sharply cut out. Make some shoreline segments softer and partially lost into the pale highland paint over a narrow uneven transition. Especially soften their western and southern margins, and let a few small stretches dissolve in translucent dry brush. Retain some firmer long curves and shallow angular inlets. Preserve total basin size and location. The result must feel like lava plains painted with lost-and-found boundaries, not stickers and not a uniform blur. Do NOT add scallops, rounded protrusions, holes, islands or repeating edge texture. Do not touch Serenitatis or Crisium's clean basin-held curves.
Everything else must stay unchanged: all interior sea mottling and streaks, sea darkness, Serenitatis's pale heart, Procellarum's westward fade, Imbrium, Copernicus, Tycho and rays, the bright calm southern highlands, overall brightness and colour. Preserve the 32-pixel lunar face.
One centered circular FULL Moon with transparent surroundings and opaque interior, near-neutral grey, pale to the edge, no phase, no halo or glow, no directional light, no shadowed crater rings, no text.
```

Output: `originals/round-10.png` (raw, unchanged).

## Round four: edit 3: Imbrium mountain arc

Mode: built-in image edit. Input: `originals/round-10.png`. Transparent background.

```text
Use case: precise-object-edit
Asset type: painted full Moon sprite for a survival game's night sky.
Input image 1: edit target, our current painting. Change ONLY the southeastern boundary of Mare Imbrium in the upper-left quadrant.
The upper-left sea currently merges into a shapeless dark western mass. Reveal Imbrium as the large round basin centred about 35% across and 25% down the disc. Paint its southeastern border as the luminous curved mountain range (Montes Apenninus) that separates it from Serenitatis and the central highlands. This is a gentle broad arc, concave toward the upper left: it descends from near 50% across / 15% down, bends near 52% / 26%, then sweeps southwest through 46% / 34% toward 36% / 38%. It should be an irregular pale painted mountain belt, broken and varied in width, roughly 1–2% of the disc diameter, visibly tracing Imbrium's round southeast edge. On the inner/northwest side keep the basin dark and calm with its existing gentle streaks. Let the pale arc merge into the already-bright highland strip between Imbrium and Serenitatis. Only the eastern and southeastern part of the basin needs this curved pale boundary; do NOT enclose the sea in a ring.
Keep Imbrium connected to Procellarum on the west. Keep Procellarum spreading west and south as the same mottled plain with streaks and its soft westward fade. Keep Copernicus at its current position below the arc. The new mountains must look like pale surface paint under full frontal sun, with no cast shadows, no dark engraved rim and no rows of bead-like peaks. No thin geometric outline. The curved belt must be readable at 512 but remain subordinate to the overall dark face at 32 pixels.
Preserve ALL eastern seas exactly as they are: smooth near-round Serenitatis with its pale heart, clean oval Crisium, softer irregular southeastern shore transitions. Preserve southern highlands, Tycho and existing rays, all other tones, fine paint, textures and geography. Do not lift the sea floors or change overall contrast.
Same centered circular north-up FULL Moon, square with transparent outside and opaque inside. Near-neutral grey, pale to the rim, no limb darkening, no directional light, no phase, no halo, no glow, no text, no crater rings.
```

Output: `originals/round-11.png` (raw, unchanged).

## Round four: edit 4: long Tycho rays

Mode: built-in image edit. Input: `originals/round-11.png`. Transparent background.

```text
Use case: precise-object-edit
Asset type: hand-painted full Moon game sprite, judged at 512 and also 32–48 pixels.
Input image 1: edit target, our nearly finished painting. Change ONLY the long faint ejecta rays of Tycho, the tiny bright crater at about 41% across and 84% down.
Keep Tycho itself as its existing small bright spot. Extend TWO OR THREE of its existing rays much farther across the lunar face. One long uneven ray should travel north-northwest from Tycho across Nubium and into the western Procellarum plain, reaching roughly 24% across / 39% down. A second should run northeast across the southern highlands and central pale ground, continuing visibly into the southern part of Tranquillitatis, roughly 67% across / 43% down. A third weaker ray may travel east-northeast across the southern highlands toward Fecunditatis, roughly 88% across / 59% down. Their lengths should be roughly one-third to one-half of the disc diameter.
These are faint painted streaks of pale ejecta, visibly fainter than the small crater, with soft feathered edges, gently variable widths and unequal intensity. Let some segments fade almost away and reappear; taper the far ends very gradually. They must visibly reach dark sea floors at 512, without whitening or obscuring the seas. They are not thin ruled lines or a symmetrical starburst. Keep only these few dominant long rays with the existing much fainter wisps. Reduce any overly regular short-spoke fan immediately around Tycho. The southern highlands stay calm and pale.
Preserve ALL other painting exactly: the new bright curved southeastern mountain arc of Imbrium; dark streaked Imbrium; the broad mottled Procellarum fading west; smooth basin-held near-circular Serenitatis with its pale heart and clean oval Crisium; Tranquillitatis, Fecunditatis and Nectaris with their softly lost shoreline sections and NO scallops. Keep sea positions, areas and dark tones, Copernicus's diffuse splash and highland brushwork. Do not change overall contrast or colour. Face must remain immediately legible at 32 pixels.
One centered circular north-up FULL Moon in square, transparent outside and opaque inside. Near-neutral grey, bright all the way to rim, no phase, no directional light, no limb darkening, no external glow or halo, no shadowed crater rings, no text.
```

Output: `originals/round-12.png` (raw, unchanged).

## Round four: edit 5: soften long rays without shortening

Mode: built-in image edit. Input: `originals/round-12.png`. Transparent background.

```text
Use case: precise-object-edit
Asset type: painted full Moon game sprite.
Input image 1 is our current painting and the edit target. FINAL minor refinement of TYCHO'S RAYS ONLY.
The two or three newly extended long rays now have the correct reach across the southern highlands and into the seas. Keep their current paths and exact long extent. Keep their far endpoints visible in the seas. But their narrow bright centre filaments are too sharp, like white threads. Replace the narrow white cores with soft, translucent grey-white scumbling, about one-quarter less intense. Feather both edges into the underlying brushwork, gently vary their width, and let tiny portions nearly disappear and reappear. The long rays should read as soft dusty streaks of light on the ground, never drawn white lines. They must remain clearly discernible at 512 and visibly run the same long distances into Procellarum, Tranquillitatis and toward Fecunditatis. Do NOT shorten them or erase their distant ends.
Keep Tycho's small bright crater unchanged as the brightest part of the ray system. Suppress only the short regularly spaced spokes immediately around Tycho so there is no sun-icon fan. Retain the subtle irregular surrounding wisps and the calm highland texture. Do not add any new rays.
Preserve absolutely everything else: Imbrium's new bright curved southeastern mountain arc; dark sea floors and streaks; Procellarum mottling and west fade; Serenitatis's pale heart and smooth near-round curve; clean oval Crisium; all corrected eastern shorelines, softened southeastern sea margins, Copernicus splash, all other paint and geography. No new scallops or bright sea outline. Keep contrast and near-neutral grey colour unchanged, face readable at 32 pixels.
One centered circular north-up FULL Moon with transparent exterior, opaque interior, pale to rim, no phase, no limb darkening, no directional light, no halo or glow, no crater rings, no text.
```

Output: `originals/round-13.png` (raw, unchanged).

## Round four: edit 6: balance ray visibility and softness

Mode: built-in image edit. Primary input: `originals/round-12.png`. Comparison input: `originals/round-13.png` (too faint). Transparent background.

```text
Use case: precise-object-edit
Asset type: hand-painted full Moon game sprite.
Two inputs are versions of THE SAME painting.
Image 1 (round-12) is the primary edit target: it has the correct long Tycho rays but narrow bright centres.
Image 2 (round-13) is a comparison only: its rays have been softened TOO MUCH and almost lost. DO NOT use image 2 as the result.
Make the final image match image 1, with Tycho's three long rays at an intermediate softness: about 80% of image 1's ray contrast, clearly stronger than image 2. The rays must remain easy to follow all the way from Tycho across the southern highlands and out into the dark seas at 512 pixels. Keep their full existing long lengths and endpoints. Preserve the small bright crater exactly. Use a soft, slightly broader dusty feather around each ray with a varied-width translucent centre instead of the skinny white filament. Do not blur away the ray, do not shorten it, do not turn it into a line, and do not add any rays. Keep the three unequal rays as the main system; only faint irregular wisps around them, no regular short-spoke sun fan.
This should be an extremely small change from image 1. All sea paint, shorelines, mountain arc, lightness, contrast, surface texture and colours must remain as in image 1. Preserve Serenitatis's pale heart, smooth clean Serenitatis and Crisium outlines, softer southeastern sea edges, mottled western plain, Imbrium's pale curved southeastern mountain arc, Copernicus. No scallops and no new basin outlines.
Keep full circular Moon, transparent exterior, opaque interior, near-neutral grey, no illumination gradient, no phase, no halo or glow, no text.
```

Output: `originals/round-14.png` (raw, unchanged).


## Round five: three isolated retouches from round three

All three calls used the built-in image tool with `originals/round-08.png` as the sole input and `transparent_background=true`. Full tool outputs are preserved unchanged; only local selected regions enter the delivery. No round-four painting is used.

### Eastern shores

Output: `originals/round-15.png`.

```text
Use case: precise-object-edit.
Input image 1 is the edit target: our ROUND THREE painted full Moon. Make one very small local correction ONLY to the OUTER SHORELINES of the five eastern seas (the right half). Preserve the entire existing painting including all sea interiors exactly.
Smooth away the repeating little round scallops around Serenitatis (pale-centered upper-right basin), Tranquillitatis just below it, Fecunditatis at lower far right, little Nectaris below centre-right, and isolated Crisium at far right. Stay within a very narrow band around the existing shores. Keep the area and extent of each sea unchanged. Serenitatis and Crisium have simple nearly circular / oval boundaries with a soft natural paint edge. The other three shores have gently asymmetric long curves and shallow inlets, with softly lost sections, no recurring bumps.
Do NOT repaint the interiors. Serenitatis is a FLAT slightly paler pool with a darker edge: no bright rim, no highlight, no shading that suggests a ball or relief. Keep its current gentle tone changes. Keep every sea calm and smooth, no added streaks, fibres, wood grain, brushed metal, ridges or directional texture. No outline of any kind.
Keep the entire western half and all southern highlands, craters, existing rays, original textures, colour, contrast, disc position, scale, orientation unchanged. No mountains or ray work in this pass. This is a shoreline retouch, not a repaint. Full even albedo painting with no light painted in, no side lighting, no halo or limb darkening. Preserve transparent exterior and opaque disc. No text.
```

### Imbrium southeast boundary

Output: `originals/round-16.png`.

```text
Use case: precise-object-edit.
Input image 1 is our original ROUND THREE moon painting, the edit target. Change ONLY a small stretch of the southeastern shore of Imbrium, the big dark upper-left basin. Preserve every other pixel as closely as possible.
Let the southeast edge of this basin read as a gentle curve against slightly brighter ground. Paint ONE soft, irregular continuous band of pale terrain, curved and concave toward upper left. In coordinates relative to the whole disc, it descends from about 50% across / 18% down, bends near 50% / 25%, sweeps through 46% / 32%, ending around 38% / 37%. The band is broad and softly blended, with uneven width and lost ends, just a LITTLE brighter than the adjacent highland paint. The basin stays open toward the west into Procellarum.
This is restrained flat surface albedo: a gently brushed smear of pale terrain, with no separate bright marks, no white dots, no beads, no chain of peaks, no craters, no crisp white line, no shiny rim, no shaded relief, no lighting from either side. Do not outline the entire basin. Do not add or sharpen any texture anywhere. Keep all seas' existing smooth gentle tonal variation unchanged; especially no fibrous texture or new directional streaks.
The required change is tiny, affecting only this curved southeastern boundary band. Keep the entire eastern half, Serenitatis, all shorelines, western plain, southern highlands, Copernicus, Tycho, rays, brightness, colour, painted texture, framing and disc size exactly as input. The scalloped shores in this input will be handled separately; do not fix them here. Same full face evenly bright to its edge, transparent exterior, opaque disc, no halo, no glow, no text.
```

### Two distant Tycho streaks

Output: `originals/round-17.png`.

```text
Use case: precise-object-edit.
Input image 1 is the edit target, our ROUND THREE moon painting. Make only a small extension of TWO of Tycho's existing soft rays. Keep the entire painting otherwise unchanged.
Tycho is the tiny bright spot at about 41% across, 85% down the disc. Keep this spot and everything within 10% of the disc diameter around it EXACTLY unchanged: do not add a ray hub or any spokes. Work only on the faint distant portions of two existing streaks.
Extend one existing north-northwest trail farther through Nubium and into the western sea, ending softly near 20% across / 43% down. Extend a second northeast trail across the pale southern ground into the lower Tranquillitatis sea, reaching about 68% across / 52% down. Keep them at DIFFERENT widths, lengths and strengths.
These are faint broad dusty washes of surface albedo with fuzzy, uneven edges, varying widths and broken/lost portions. No narrow bright core. They must be visibly softer and much fainter than the tiny crater. Let each trail drift gently, broaden in a few places, thin away, have gaps, and dissolve at its distant tip. Neither is a straight ruled line. No radial fan, no sun icon, no starburst, no white spokes, no fine shiny threads, no added small rays.
Keep the highlands calm and smooth. Keep all sea floors and their gentle tone variation unchanged except the two very faint crossing washes. No added directional texture, fibres, wood grain or ridges. No overall increase of texture, brightness or contrast.
Do not alter any coast, sea shape, Imbrium, Serenitatis, Copernicus, other craters, geography, composition, disc scale or colour. The input's remaining shoreline shapes are intentional for this isolated pass; do not fix them. Full evenly bright moon, transparent exterior, opaque disc, pale to edge, no lighting gradient, phase, halo, glow, text or shaded crater rings.
```
