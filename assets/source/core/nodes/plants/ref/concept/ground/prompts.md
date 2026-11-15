# Round 1 generation prompts

Tool: built-in `image_gen`. All images are original generations from the written brief or edits of images generated for this round. No outside image references were used. Each prompt requests the largest available native output; files retain the returned pixel dimensions without resizing.

## 01 — palmetto base

Inputs: none.

```text
Use case: stylized-concept.
Create one original production concept image for a buildable low ground plant in a high-end realistic survival game. Work solely from these words, without referencing any existing game or source image. Render at the largest native image resolution available, landscape 3:2.
Subject: a single mature saw palmetto clump, 1.25 metres high and 2 metres wide, alone on pale sandy ground with a few limestone rubble pieces and one small fragment of cracked concrete. Three-quarter view, camera 1.7 metres above ground and about 3 metres from the plant; look slightly down so the entire low clump and its ground attachment are visible. The plant fills most of the frame with breathing room around every tip.
Construction is the subject: about SIXTEEN distinct stiff fan-shaped leaves, each on its own long slender petiole, plus two hanging dead fans. Each fan is a coherent pleated fan blade split radially into many narrow sharply pointed segments; segments remain joined in the lower inner portion of the blade. Some blades show their broad face, others are oblique or almost edge-on. Clear spaces between major fans, clearly separated silhouettes, no anonymous foliage filler. Stalks 0.4–1m long with tiny saw teeth along their sides, blades 0.5–0.9m wide. Two low fibrous creeping trunks and overlapping old petiole bases are visible near ground level. No upright tree trunk.
Natural asymmetry: one low lateral branch extends to the right; the silhouette rises toward the rear left; a few front stalks dip low. Mature leaves muted silvery blue-green and olive; two smaller upright yellow-green new fans, one central folded spear; two orange-brown old fans drape at the base, one mature blade has a broken tip. Broad chunky readable spiky fountain silhouette, dark open interior, not a radial wheel and not a solid leafy ball.
Style and light: photorealistic finished modern game environment render at maximum settings, physically plausible matte leaf cuticle, subtle longitudinal fibres and pleats, restrained roughness, warm angled afternoon sun from upper left, soft blue sky illumination within the shaded crown. Hot humid coastal atmosphere. Ground and plant sharp enough for a 3D artist to build exactly this object; quiet simple receding sandy background, no competing vegetation.
No people, animals, tools, pots, flowers, labels, borders or watermark. No cartoon, painterly strokes, waxy gloss, perfect symmetry, shredded grass-like fan blades, or dense wall of tiny leaf texture.
```

## 02 — palmetto camera revision

Inputs: round1/01_palmetto_low_camera.png (edit target).

```text
Use case: precise-object-edit.
Input image 1 is the original saw palmetto concept generated for this project, and is the edit target. Create an improved production concept at the largest native resolution available (request 3840x2560 landscape).
Change the CAMERA AND FRAMING only: raise the camera to a standing person's eye height of 1.7 metres, about 3 metres from this 1.25m high by 2m wide low clump, looking gently downward from a three-quarter angle. Pull back enough that every fan tip and both dead leaves are comfortably inside the frame with at least 8 percent empty margin. Show sandy ground behind the entire plant rather than a sky horizon crossing the plant. This must feel like a low plant seen by a standing player, not a tall bush photographed from the ground.
Keep this plant's original mature silvery green fans, new yellow-green fans, single folded spear, two orange-brown dead fans, the asymmetric rightward spread, two low fibrous creeping trunks and old leaf bases, small saw teeth on thin stalks, natural matte materials, pale limestone rubble, and warm left afternoon sunlight with soft skylight. Preserve roughly sixteen individually readable live fans; retain open gaps between blades and dark interior. Each fan is a coherent pleated palm blade whose narrow pointed radial segments remain joined toward the centre, attached to exactly one petiole. No filler foliage, new plants, text, frames, props, people or external references. Photorealistic high-end survival-game environment render with crisp buildable geometry.
```

## 03 — fern base

Inputs: none.

```text
Use case: stylized-concept.
Create an original production concept image of a fern clump for a high-end realistic survival game. Work only from these words, without any existing game or other source image. Largest native image resolution available, request 3840x2560 landscape.
One fern clump, alone on pale sandy soil, with a few irregular limestone chips and a broken concrete edge. Three-quarter view from approximately 3 metres away at standing eye height 1.7 metres, looking down at the whole low plant. Clump about 0.75m high and 1.2m across, occupying 75 percent of frame width, all tips and ground attachment visible with generous margins; sandy ground continues behind it, no horizon through the plant.
Buildable arrangement: about SIXTEEN distinct arching sword-shaped fronds, each a single long tapering central rachis with many small simple oblong pointed leaflets attached directly on either side, a single row per side. Do not branch the leaflets into lacy sub-leaflets. Each complete frond has a legible long blade silhouette from base to tapering tip. Fronds 0.5–1.1m long. Exposed slender stalks connect to a compact ground-level crown. Readable gaps between the main fronds; no mass of tiny foliage. The upper young fronds are shorter and upright, the mature fronds rise and bow out in long graceful arcs, the outer oldest fronds lie nearer the soil. Two small uncurling fiddleheads clearly visible at the centre; two thin warm brown dead fronds lying outward at the edge. Deliberately asymmetric, fuller toward rear left, one long low arch to right, a small open wedge in the front revealing the crown. Never a perfect circle or symmetrical bouquet.
Fresh natural green, paler new growth, deeper olive interior, slight age wear on two outer tips. Matte leaf surfaces with restrained vein detail; soft filtered translucency in a few sunlit leaflets. Warm afternoon sunlight from upper left with soft sky fill in the shadows; hot humid coastal light. Photorealistic finished modern survival-game rendering at maximum settings, realistic materials, chunky clear overall shapes, sharp frond edges. Simple quiet ground to keep focus on the plant.
No people, animals, pots, tools, labels, borders, watermark, cartoon, oily shine, decorative floral arrangement, individual grass blades, or dense texture cloud.
```

## 04 — palmetto individuals

Inputs: palmetto.png (design reference).

```text
Use case: stylized-concept.
Input image 1 is a design and material reference made for this project, not an external reference. Create a NEW comparison image of THREE distinct saw palmetto individuals, faithfully using its fan geometry, matte surfaces, sun direction and grounded realism. Largest native resolution available, request 3840x2560, landscape 3:2.
A production comparison plate with exactly three whole plants side by side, their bases aligned on one continuous flat sandy surface. SAME WORLD SCALE and camera perspective for all three. Warm angled afternoon sunlight and soft sky illumination. Camera at 1.7m standing eye height, distant enough to see the complete trio, looking slightly down. All tips fully inside image; clear sandy gaps between plants, no plant touches another. Background quiet pale sand and sparse limestone rubble, no sky horizon across plants, no lettering.
LEFT young: 0.9m tall and 1.5m wide, about nine live fans, one lime new spear, a single short creeping fibrous base barely revealed, mostly fresh yellow-green fans with varied oblique angles, one tiny brown basal remnant, naturally uneven growth.
CENTRE mature: 1.3m tall, 2m wide, about sixteen live fans and two brown basal fans. Silvery olive and blue-green older leaves, two smaller pale yellow-green new fans and a central folded spear. Two low creeping trunks with distinct fibrous old leaf bases. Asymmetric spiky fountain, taller left rear and lower rightward extension, visible slender toothed stalks and separated fan silhouettes like the reference.
RIGHT old sprawling: 1.1m high and 2.5m wide, about eighteen live fans, three orange-brown hanging or ground-level dead fans, two branching fibrous horizontal trunks partly exposed between offset crowns; overall growth leans sideways to reach light, with more weathered grey-green fans, some broken tips and one green spear. It is wider and flatter than the centre plant, not simply scaled up or recoloured.
Every fan blade has a connected pleated inner palm surface and pointed radial outer segments, attaches to one thin saw-toothed petiole, is clearly legible and individually buildable as a bent cutout card. Leaves differ in size, facing direction, angle and age. Open dark interiors; avoid anonymous filler. Show all three as plant assets in one photographic composition, no inset panels.
Photorealistic high-end finished modern survival-game still, warm humid coast, natural restrained color, no plastic gloss, perfect circles, copied clones, dense fuzzy texture, ornamental pots, people, tools, labels, borders or watermark. Work only from this prompt and the project-generated reference.
```

## 05 — fern individuals

Inputs: fern.png (design reference).

```text
Use case: stylized-concept.
Input image 1 is the fern design and material reference generated for this project. Create a NEW image of THREE distinct fern individuals using the same single-pinnate leaf anatomy and photorealistic matte materials. Work only from these words and the project-generated reference. Largest native resolution available, request 3840x2560 landscape 3:2.
Three whole fern clumps side by side, young at left, mature at centre, old sprawling at right, all at the SAME WORLD SCALE with their ground-level crowns aligned on one pale sandy surface. Camera standing eye height 1.7m, looking gently down from far enough back to include all three. Clear empty sandy gaps separate each individual. Every tip remains inside the image, 8 percent outer margins. Quiet sandy background, sparse tiny limestone debris, a low fragment of concrete; no distracting vegetation or horizon crossing plants.
LEFT young: 0.5m tall, 0.8m wide; nine small fresh light-green fronds, compact but uneven, two partially uncurling central fiddleheads and an upright new blade. Minimal dead material.
CENTRE mature: 0.8m tall, 1.2m wide; sixteen fronds, fresh green with darker interior. Shorter upright new blades around two visible fiddleheads; mature sword-shaped fronds curve up, out, and down in long individual arcs. Two brown spent fronds lie on soil. A front gap exposes the crown and the separate plain stalks. Different lengths, unequal spacing, taller at rear-left.
RIGHT old sprawling: 0.65m tall, 1.5m wide; eighteen long low arching fronds, one side extending farther and touching soil. A few worn yellowing tips, three broken or rusty brown dead fronds around an off-centre older crown, and one small new fiddlehead. Broad and flattened, not a taller clone.
An individual frond is one continuous tapering central rachis carrying many SMALL SIMPLE pointed leaflets directly along both sides, one row each side; no secondary branching, no compound lace. Each frond is readable as a separate narrow sword-shaped bent cutout. Maintain clean gaps and long tapering silhouettes, no foliage cloud and no perfect radial circles.
Warm afternoon light from upper left filtered lightly through unseen canopy, soft sky fill in shadow, hot humid coastal realism, finished maximum-settings survival-game materials. Leaf surfaces matte and detailed but not glossy. No pots, people, animals, tools, labels, borders, watermark, grids or text.
```

## 06 — palmetto flat leaf elements

Inputs: palmetto.png (design reference).

```text
Use case: stylized-concept.
Input image 1 is a project-generated saw palmetto clump, used ONLY to preserve the leaf species, geometry and material palette. Make a NEW flat element reference plate for its 3D artist. Largest available native resolution, request 3840x2560 landscape 3:2.
Exactly TWO separate whole saw palmetto leaves, side by side, each complete from its pointed blade tips to the bottom end of its long narrow toothed petiole. Left is a healthy mature silvery olive-green leaf, right is an old dry orange-brown leaf. No clump, no trunk, no ground, no additional specimen, no text.
Both leaves are laid flat against an absolutely plain uniform mid-neutral-grey background, viewed perfectly straight on with orthographic projection. Blade faces parallel to image plane, stalks pointing down, all boundaries crisp, at least 7 percent margin, no overlap between specimens. Both rendered at the same botanical scale. Leaf geometry and subtle surface relief remain realistic, but neither leaf is turned sideways, folded edge-on or foreshortened.
Healthy leaf: a 0.75m wide broad fan blade on a 0.7m long slender stalk, about 32–40 narrow pointed segments radiating from ONE central blade attachment. A connected pleated inner fan web, deep splits toward the outside, subtle radiating vein folds; natural unequal tip lengths and a small damaged tip, not perfectly mirrored. The stalk has clearly visible small backward-pointing triangular saw teeth along both edges, attached to its edges, not floating.
Dead leaf: same fan anatomy and comparable dimensions, dried copper, ochre and warm umber. Still spread open and flat to make a usable cutout, with narrow visible gaps, a few splits and two broken tips; dry longitudinal fibres and fine papery wrinkles. Long brown petiole with small saw teeth is complete and separate.
Realistic matte material rendering matching the reference, soft warm directional light plus skylight enough to read subtle pleats, neutral exposure. NO ground-contact shadow or cast-shadow silhouette on the grey, no background texture, gradients, vignette, specimen mounts, rulers, labels, borders or watermark. This is a pristine straight-on production cutout SOURCE plate, not a photographic bouquet or botanical painting. Do not use any outside images.
```

## 07 — fern flat frond elements

Inputs: fern.png (design reference).

```text
Use case: stylized-concept.
Input image 1 is the project-generated fern clump and defines the plant's leaflet anatomy, colour and material. Make a NEW flat element reference plate for its 3D artist using only this reference and these words. Largest native output available, request 3840x2560 landscape 3:2.
Exactly THREE separate complete fern elements, side by side against absolutely plain uniform mid-neutral grey: a mature fresh green frond on the left, a young uncurling green frond in the middle, an old dead brown frond on the right. Every stalk base and every tip fully visible, clear empty gaps between elements, no overlap. All at the same botanical scale, so the young frond is shorter. No other objects or text.
Each specimen is laid flat in the image plane, viewed perfectly straight on, orthographic projection, stalk end down. Full mature frond about 0.9m long with its plain bare lower stalk, a continuous narrow central rachis and approximately 30 pairs of small SIMPLE oblong-pointed leaflets directly attached along both sides. A single row of leaflets per side, no secondary branching. The leaflets taper from longer near the lower middle to tiny near the pointed top, together forming one long narrow sword-shaped silhouette. Leaflets have tiny natural spacing, gently serrated edges, faint veins, slightly uneven spacing and lengths. Leaf faces are broadside and flat, no perspective foreshortening.
Young frond: 0.35m long, full slender green stalk, lower small leaflets starting to open and an unmistakable tightly curled crozier at the upper end, curled in the image plane so the spiral is visible.
Dead frond: 0.8m long, the same singly pinnate sword outline, dry rusty brown and ochre, a few missing or broken small leaflets and slightly irregular ragged edge, attached leaflets individually visible, entire central rachis and stalk intact. Gently wavy within the plane but flattened for cutout, not heaped or folded in depth.
Photorealistic maximum-settings modern survival-game plant materials, natural matte leaf cuticle, subtle fibres, soft warm light and soft sky fill. Even clean exposure with no specular plastic effect. NO shadows cast onto the grey background, no background grain, gradient, vignette, ground, soil, mounts, rulers, labels, borders or watermark. Clean production cutout-source plate, not an illustrated botanical poster.
```

## 08 — palmetto harvested state

Inputs: palmetto.png (edit target).

```text
Use case: precise-object-edit.
Input image 1 is the selected original palmetto clump concept and is the EDIT TARGET. Paint the same plant in the same place immediately AFTER a survivor harvested its leaves. Use the largest available native image resolution, request 3840x2560 landscape.
Keep the same camera, full plant footprint and surrounding sandy ground, the same low creeping fibrous trunks and old overlapping leaf bases, rubble and concrete chip, warm upper-left afternoon sun, sky fill, and photorealistic high-end game materials. Change only the harvest state and its immediate debris.
REMOVE ALL open living fans from the standing clump. Remaining attached structure: the two short horizontal fibrous trunks, roughly six unequal thin petiole STUBS, each only 10–30cm long with visible small pale angular cut ends and saw teeth, and exactly ONE youngest narrow folded yellow-green spear rising approximately 45cm above the crown. The spear is closed, not an open fan. The surviving plant is dramatically lower and visibly depleted, never a small intact bush. Preserve two attached old orange-brown dead basal fans sagging onto the ground.
Three recently cut mature green fan leaves lie scattered on the sandy ground around the crown, each whole identifiable fan separated from the others, attached to a section of cut toothed stalk. One broad face up at front left, one oblique on right, one partly visible behind the crown. Their orientation and asymmetry look like fallen cut leaves, not a neat radial arrangement. Their fan blades must match the original coherent pleated palm blades with narrow radial outer points; avoid substituting grass piles. Show their shadows on the sand and clearly disconnected cut stem ends. A few tiny fibres on ground only, no heap of mulch.
No person, hand, tool, labels, text, additional live plant, pot, border or watermark. Do not change the species, turn the base into a tree stump, add a large cut log or invent outside references. This is an immediately readable harvested-state game asset reference.
```

## 09 — fern harvested state

Inputs: fern.png (edit target).

```text
Use case: precise-object-edit.
Input image 1 is the selected fern clump concept and the EDIT TARGET. Create its immediately harvested state in the same place. Largest native image resolution available, request 3840x2560 landscape.
Preserve camera position and overall frame, the sandy ground and small limestone/concrete debris, warm upper-left afternoon light and soft sky illumination, and natural realistic high-end game materials. Change the plant to a thoroughly harvested fern: nearly all green fronds have been TORN AWAY, leaving the compact exposed brown fibrous crown at ground level and about seven short ragged stalk bases of unequal height. These have torn fibrous green-beige ends, not identical smooth cuts. The remaining mass is only 15–25cm high, apart from one slender broken half-frond leaning low to the right.
Only TWO attached damaged green frond remnants remain, each with a clearly legible central rachis and a handful of simple leaflets. One is 25cm long with a snapped bare tip; the other is a drooping 40cm half-frond, snapped before its tapering end. A very small uncurling fiddlehead survives close to the crown. Two original brown spent fronds remain lying low at the edge.
On surrounding sand lie TWO detached green frond pieces, separated and naturally scattered, with torn stem ends and readable sword-like leaflet anatomy matching the original. Most harvested biomass has been removed; no thick pile and no intact tall rosette. Keep the centre open so the crown and torn stalks are easy to model. Plant remains rooted; no detached root ball and no hole.
Photorealistic matte leaves and fibres, physically plausible contact shadows and modest translucency. No people, tools, hands, animals, pots, labels, borders or watermark. Only this project-generated image and the prompt may supply visual references.
```

## 10 — fern harvested crown revision

Inputs: round1/09_fern_cut_woody_crown.png (edit target).

```text
Use case: precise-object-edit.
Input image 1 is the harvested fern concept to improve. Largest native output available, request 3840x2560 landscape.
Correct ONLY THE CROWN AND THE BROKEN STALKS. This is a soft herbaceous fern, not a woody palm or cut sapling. Replace the thick brown splintered upright stem bundle with a low compact dark-brown crown about 10cm across, hugging the ground. From that crown emerge only seven very slender green or olive rachis remnants, 5–8mm thick and unevenly 5–15cm tall, with small soft pale torn ends. A few fine brown fibres at their bases, not a mass of bark, wooden splinters or jagged trunk shards. The attachment should resemble the base of the delicate fern fronds in the scene. Keep one small living fiddlehead low at the centre.
Preserve exactly the two attached broken frond remnants, their leaflet outlines, the two loose green frond pieces, two dead brown fronds on sand, the camera, all ground and rubble, lighting, shadows, composition and realistic matte material style. Keep the plant unmistakably harvested and mostly absent. No new intact fronds or objects, no outside references, no text. The physical change is thinner soft broken stalks and a much smaller ground-hugging crown.
```

## 11 — palmetto habitat

Inputs: palmetto.png (design reference).

```text
Use case: stylized-concept.
Input image 1 is this project's selected saw palmetto design reference. Create a NEW environment concept using precisely its low clumping fan-palm anatomy, chunky distinct fans, creeping bases and natural matte materials. No outside image references. Largest native resolution available, request 3840x2560 landscape 3:2.
A finished photorealistic high-end modern survival-game still of a warm coastal city centuries after abandonment. A sunlit vacant lot of fractured pale concrete and limestone rubble, sandy seams between broken pavement slabs, low roofless limestone walls and damaged door openings beyond. A few distant palms, and a fig with hanging roots at the side, subdued enough to let the ground plants dominate. Glimpse of humid pale blue distance through the ruins. No people or animals.
Camera at a standing player's eye height of 1.7m, about FIFTEEN METRES from the MAIN GROUP of palmettos, a natural approximately 50mm-equivalent view. The image is a habitat view, not another close-up plant portrait. A stretch of cracked pavement in foreground leads to the plants. Door openings around 2.1m high and low ruins supply believable scale: the palmettos are low understory, only 0.9–1.6m tall and 1.5–2.5m wide, never trees. Main group spans the lot in the middle of the composition.
About twelve distinct clumps grow irregularly from sandy cracks and rubble pockets, with visible open ground between the main five clumps and further overlapping clumps receding beyond. Young smaller yellow-green clumps, mature silvery blue-green clumps, one old low sprawling clump with exposed creeping trunk and orange-brown dead basal fans. Variation comes from age, leaning angles and spacing, not random species. Broad silhouettes clearly read as spiky fountains of 12–20 individually legible fan blades, all on narrow stalks. Each blade has connected pleated inner fan tissue and narrow pointed outer radial segments. Fans at different oblique angles, open dark interiors, never a uniform brush texture. Neighboring clumps can overlap lightly but must retain their individual identity.
Warm afternoon sun from upper left, soft sky light in shadows, hot humid coast, sandy cream ruins, restrained foliage greens and rusty dead leaves. Realistic concrete erosion, moss only in suitable small shaded cracks. Sharp readable middle distance, subtle atmospheric depth further away, no cinematic blur across the plant group, no overdone dramatic fog. No tropical jungle wall, grass meadow, tall palmetto trunks, perfect landscaping rows, clone repetition, cartoon, painterly strokes, gloss, text, labels, borders or watermark.
```

## 12 — fern habitat

Inputs: fern.png (design reference).

```text
Use case: stylized-concept.
Input image 1 is this project's selected fern clump and defines the frond anatomy, buildable count and fresh-green material palette. Create a NEW habitat concept using only this project-generated reference and these words. Largest native output available, request 3840x2560 landscape 3:2.
Photorealistic finished high-end modern survival-game view of a warm coastal city centuries after abandonment. Fern clumps colonize the SHADED FOOT OF A RUINED PALE LIMESTONE AND CONCRETE WALL. The wall has eroded plaster, exposed limestone, damp lower discoloration, a broken doorway and a partially collapsed top. A few hanging fig roots descend near one end. Sand, dark leaf litter, scattered limestone rubble and cracked paving below. The upper stone catches warm afternoon sunlight; the fern bed receives mostly soft cool skylight and occasional gentle warm patches. Humid coastal atmosphere.
View from a standing player's eye height of 1.7m, the main fern group approximately FIFTEEN METRES away. Approximately 55mm-equivalent lens to see the plants and a stretch of wall at useful middle-distance scale; a broken doorway about 2.1m high establishes scale. The low ferns are 0.5–1m tall and 0.8–1.5m across. This is a habitat view, not a foreground hero plant. Foreground cracked pavement leads to the wall. No fern closer than about 10m.
Nine to twelve irregularly spaced individual fern clumps along the shaded wall base and in rubble pockets, including young upright smaller clumps, mature full arching rosettes and an old flatter sprawling one. The nearest main five clumps retain separate outlines and little gaps of shaded sand between them. Each clump built from roughly 12–20 distinct long tapering sword-shaped fronds, each frond one narrow rachis with small SIMPLE leaflets directly along both sides. No lacy secondary branching. Fronds rise from ground crowns, arc outward and downward, different lengths and uneven directions. Small fiddleheads and a few brown spent fronds visible on nearer clumps. Fresh green catches skylight, interior dark olive, natural matte cuticle. Each arching frond must remain a readable complete blade and the clumps soft asymmetric rosettes, not a noisy dense foliage texture.
Warm sunlit ruined upper wall contrasts naturally with softly lit shaded plant bed, no black crushed shadow, no wet plastic glare, no bloom, no shallow-depth blur, no rain. Distant overgrowth seen through doorway remains subordinate. No people, animals, tools, benches, pots, rows, text, labels, borders or watermark.
```

## 13 — palmetto habitat — distance and city revision

Inputs: none; fresh generation to correct framing and terrain.

```text
Use case: stylized-concept.
Original concept for low saw palmetto ground-cover in an abandoned warm-bay city. Work from these words alone; do not reference any existing image, game, artist or photographed place. Generate at the largest available native resolution, request 3840x2560 landscape 3:2.
COMPOSITION FIRST: a wide eye-height environmental view across an overgrown vacant city lot. Camera 1.7m high, natural 40mm-equivalent perspective. The nearest saw palmetto clump is FIFTEEN METRES away. All plants are in the MIDDLE DISTANCE, no foreground hero plant. A 1.2m-tall palmetto at this distance occupies about 15–20 PERCENT of the image height, no more. The bottom quarter of the frame is empty cracked road and sandy pavement leading toward the group. The largest plant must be less than one fifth of the image height. Show a GROUP OF EIGHTEEN LOW CLUMPS across the lot, uneven patches with visible ground between them and further clumps behind. The subject is how numerous low plants carpet a ruined city, not a single specimen portrait.
CITY: centuries-abandoned coastal urban district. Rectangular reinforced-concrete walls, exposed flat floor slabs, pale limestone cladding, a broken asphalt street and kerb, sand collecting in cracks, low piles of concrete rubble. Roofless remnants of ordinary boxy modern buildings in background, partly hidden by palms and a fig with hanging roots. Only a small distant glimpse of a flat warm blue bay and mangrove edge. FLAT coastal terrain, no mountains, hills, cliffs, stone castle, ancient classical columns, ornate Mediterranean villas or historical town. Give quiet concrete geometry for scale. One intact-sized rectangular doorway about 2.1m tall stands behind the plants; plants below waist/chest height.
PLANTS: all saw palmetto, three age habits mixed naturally. Young yellow-green clumps 0.9m high x 1.5m wide with 8–10 fans. Mature 1.2–1.5m high x 2m wide with 14–18 live fans, old sprawling 1m high x 2.5m wide with two branching horizontal fibrous trunks and hanging orange-brown dead fans. Mature leaves muted silvery blue-green and olive, new leaves yellow-green. Each fan a distinct stiff coherent pleated palm blade with many pointed radial outer segments, connected inner fan tissue, one long narrow saw-toothed petiole. Fans 0.5–0.9m wide, held at varied upward and outward angles, some broadside and others oblique. Asymmetric spiky fountain silhouettes and clear gaps between major fan blades, darkest at the inside. No tree trunks on the palmettos. Individual fans in main middle-distance clumps remain recognizable and buildable from a dozen or two bent cutout cards; far clumps simplify into legible spiky shapes. Natural wear and small dead orange-brown skirts, no texture fog, no clone repetition, no landscaped grid.
STYLE: photorealistic finished high-end modern survival-game still at maximum settings, matte natural leaf cuticle, credible rubble and weathered concrete, warm afternoon sunlight angled from upper left, soft blue skylight shadows, restrained natural colour, hot humid air, clear middle distance and slight haze only far beyond. No shallow depth of field. No people, animals, tools, pots, labels, text, frame or watermark.
```

## 14 — fern habitat — distance and terrain revision

Inputs: none; fresh generation to correct framing and terrain.

```text
Use case: stylized-concept.
Create an original production environment concept showing low ferns reclaiming the shaded base of a city ruin. Work exclusively from these words, no existing game or other source image. Largest native resolution available, request 3840x2560 landscape 3:2.
CAMERA AND SCALE: standing eye height 1.7m, about FIFTEEN METRES from the main fern bed, approximately 50mm equivalent lens. A wide contextual scene, not a close plant portrait. The main fern bed runs horizontally across the middle distance. The biggest fern is 0.9m high and occupies only 12–16 PERCENT of image height. None exceeds one sixth of the image height. Empty cracked pavement spans the lower third of the frame between the viewer and the ferns. The whole lower ruin wall, a doorway, a window void, and adjacent rubble are visible above and behind the small plants.
WORLD: a warm flat-bay city centuries after abandonment. A broad ruined modern concrete wall with patches of pale limestone cladding and peeling plaster, plain rectangular broken doorway 2.1m high and rectangular window opening, broken flat slab top with a little corroded rebar, damp darkened foot and a few descending fig roots near one end. No arches, classical columns, castle, decorative old-world stone town, hills or mountains. Flat ground and faint palms beyond the wall openings. Wall foot in shade under an off-frame canopy; warm angled afternoon sun lights the upper wall and patches of foreground paving, cool soft skylight clearly reveals the green plants.
FERNS: around fifteen small-to-mature fern clumps grow from sand, damp leaf litter and rubble pockets along the wall base, in uneven overlapping patches with little dark ground gaps. Nine principal clumps have individually distinct silhouettes. A mix of 0.5m high compact young clumps, 0.8m high mature clumps, and lower broader old sprawling ones, widths 0.8–1.5m. Mature clump is approximately sixteen long sword-shaped fronds on simple slender stalks, rising from a ground-level crown then arching out and down. Each frond has one thin central rachis with MANY small SIMPLE pointed leaflets directly attached along both sides, a single row per side; no secondary lacy branching. Whole fronds readable as distinct slender tapering blades, not a bush of texture. Fresh bright natural green, darker green interiors, one or two small central curled fiddleheads on nearer specimens, two brown dead fronds lying near the edges. Fronds differ in length, tilt, age and curve. Irregular soft rosette silhouettes, never a perfect radial ring, never a solid uniform hedge.
Photorealistic high-end modern survival-game render, maximum settings, physically plausible rough materials, matte delicate leaf cuticle, soft natural shadows, readable middle distance, tropical coastal humidity without fog. Prioritize the small ground-cover scale, the shaded wall habitat, and clearly separable arching fern shapes. No foreground fern, giant plant, people, animals, pots, tools, UI, labels, text, border or watermark.
```

## Output register

All calls used `transparent_background: false`. Images with an input used `referenced_image_paths` for the listed local file; calls without an input omitted reference arguments. The prompt strings above were checked verbatim against the strings sent to the tool. Each generation returned one 1536 × 1024 PNG, preserved without resizing.

| Prompt | Decision | Saved file |
| --- | --- | --- |
| 01 | Rejected | round1/01_palmetto_low_camera.png |
| 02 | Selected | palmetto.png |
| 03 | Selected | fern.png |
| 04 | Selected | palmetto_individuals.png |
| 05 | Selected | fern_individuals.png |
| 06 | Selected | palmetto_fan.png |
| 07 | Selected | fern_frond.png |
| 08 | Selected | palmetto_cut.png |
| 09 | Rejected | round1/09_fern_cut_woody_crown.png |
| 10 | Selected | fern_cut.png |
| 11 | Rejected | round1/11_palmetto_place_too_close.png |
| 12 | Rejected | round1/12_fern_place_wrong_terrain.png |
| 13 | Selected | palmetto_place.png |
| 14 | Selected | fern_place.png |
