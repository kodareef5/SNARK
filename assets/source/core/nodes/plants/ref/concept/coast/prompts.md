# Round 1 — exact image prompts

Generated with the **built-in imagegen tool**, one image per invocation. No external pictures were searched for, downloaded, or used. The supplied map was inspected only for geographic context and was never passed to image generation. All image inputs below are original images generated in this round.

Every call used `transparent_background: false`. Calls with inputs used `referenced_image_paths` pointing to those local files; calls without inputs omitted both reference parameters. The grey parts sheets are deliberately opaque, as requested.

The tool exposes no explicit resolution setting. The prompts requested its largest native output (most also requested 3840×2160 if available). All ten selected files were returned at **1672×941** and are saved unchanged at that native size. The first archived study is 1536×1024. No resizing, upscaling, compositing, or pixel editing was applied after generation.

## 01 — round1/01_seagrape_initial.png

Output: `round1/01_seagrape_initial.png`

Inputs, in order: none.

Review: Archived: upright central structure read too much like a small tree; fruit bunches too compact.

Exact prompt:

```text
Use case: stylized-concept.
Asset type: buildable realistic plant concept, sea grape hero view, for an original survival game.
Create one photorealistic finished-game still at the largest native resolution available, landscape 3:2. No writing or panels.
Scene: a sandy coastal edge in a warm bay city centuries after abandonment, a few small pieces of pale broken concrete on the ground. Quiet unobtrusive backdrop with a little pale bay and distant palms; the whole focus is ONE sea grape shrub.
Camera: three-quarter view, camera 1.7 m above ground, about 3.5 m from the plant, normal perspective, whole shrub and its contact with the sand in frame with comfortable margins.
Plant: a low broad asymmetrical wind-shaped sea grape, 1.5 m tall and 2.7 m wide. Six crooked smooth grey-brown branches grow from a low branching base, bending sideways into several unequal open fans. The branch paths must remain clearly visible THROUGH generous irregular gaps in the foliage. Individual round leathery leaves 12–25 cm wide, short petioles, flat or lightly cupped, never pointed; larger mature dull olive-green leaves, smaller fresh yellow-green leaves, pale veins and a few subdued red veins. A handful of old red-orange leaves and two insect-holed leaves. Arrange about 75–100 readable single leaves in loose groups along the limbs, some face-on to afternoon light, others turned sideways or showing paler undersides. No leafy clumps hiding the structure. Four hanging loose slender clusters of small round fruit grading from green to dusty purple, borne under outer branches.
Silhouette: broad low broken canopy, an off-center crown and a long lower windward arm; conspicuous individual round leaf outlines and open branch windows. A living shrub, not a miniature tree, a topiary, or an ornamental bonsai.
Materials and light: warm afternoon sunlight from an angle, soft blue sky fill in shadows, restrained natural colors, matte waxy leather leaves with fine veins, smooth weathered branch bark, granular pale sand and chalky concrete. Realistic high-end real-time rendering with chunky legible forms, deep sharp focus on the plant, no plastic gloss, no painterly strokes.
Production constraint: a 3D artist must build exactly this plant using a small leaf atlas instanced singly on a simple branching frame plus separate fruit cards. Beauty comes from leaf placement and branch rhythm, never a dense texture of tiny foliage. No people, animals, tools, pots, interface, text, labels, watermark, or copied visual reference. Work only from this written description.
```

## 02 — seagrape.png

Output: `seagrape.png`

Inputs, in order: `round1/01_seagrape_initial.png`.

Review: Selected: lower open shrub, multiple low stems and narrow hanging fruit clusters.

Exact prompt:

```text
Use case: precise-object-edit.
Input image 1 is an original sea grape concept from this project, the edit target. Refine its growth architecture into a LOW, WIDE COASTAL SHRUB. Keep its realistic leaf materials, warm afternoon sun, soft sky fill, sandy bay setting, ruined concrete fragments, and camera at standing eye height. Preserve the very clear separate round leaves and negative spaces.
Change the plant architecture: spread the same plant across a 2.8 m width but lower its crown to 1.45 m; several crooked grey-brown stems fork independently at sand level and weave outward, without a central upright trunk. Put the highest crown left of center, one long low arm reaching right, two intermediate lobes with irregular open gaps. Make limb thickness more slender than the original, with natural twists, not bonsai sculpture. Leaf density can increase modestly in the middle lobes while retaining clear branch windows: around 95 single round leaves, 12–25 cm across, placed along short petioles. Leaf edges mostly circular and entire, very gently irregular rather than deeply ruffled. Retain 5 red-orange leaves, small lime young leaves and some red veins. Reduce insect damage to two small irregular bites or holes on only two leaves; remove the leaf that resembles a skeleton.
Fruit correction: four slender hanging loose racemes, each with 14–22 small round berries distributed along a thin visible 20–30 cm stalk, green to dusty purple. Narrow airy dangling clusters, not compact bunches of large table grapes.
Framing: entire plant with a margin on all sides, three-quarter view from 3.5 m, camera height 1.7 m, natural normal perspective. Landscape image at the largest native resolution the tool supports, ideally 3840x2160 if available. High-end finished survival-game realism, natural restrained greens and warm stone, no stylization, labels, text, UI, people, animals or tools.
```

## 03 — round1/03_creeper_initial.png

Output: `round1/03_creeper_initial.png`

Inputs, in order: none.

Review: Archived: too much exposed support and a triangular rocky peak.

Exact prompt:

```text
Use case: stylized-concept.
Asset type: realistic buildable creeper plant hero concept for an original survival game.
One photorealistic still from a finished high-end survival game. Largest native output available, prefer 3840x2160 landscape if supported. No writing, panels or interface.
Scene: sandy ground with a few broken pale concrete fragments in a hot humid coastal city abandoned centuries ago. Unobtrusive background, subtle bay haze. ONE freestanding vine-smothered rubble mound, not attached to a wall.
Camera: three-quarter view from about 3.5 m, eye height 1.7 m, natural perspective; whole plant plus the ends of all ground runners fully inside frame with generous margins.
Subject: an irregular low mound 1.15 m tall, 2.4 m across, made of three unequal humps of rubble and a few dead branches. It is mostly smothered by climbing and trailing creeper vines. Only a few glimpses of rough chalky support remain. The plant has no shrub trunk and no self-supporting woody crown. Its lumpy blanket silhouette comes from vine sprays draped over the supports, with the tallest lobe off-center and one low side spill. Thin olive-to-brown runners visibly snake across the mound in diagonal arcs.
Leaves: matte natural mid-green heart-shaped leaves with clear basal notches and tapered tips, 5–15 cm long, occasional shallow three-lobed leaves; young small pale-green tips, dark mature leaves, two yellowing leaves and a few tiny insect bites. Leaves belong to READABLE SPRAYS, each spray 5–9 leaves along one visible slender branching runner, with small sky or shadow gaps outlining individual leaves. Several overlapping sprays make each large lobe; larger shadow windows separate the lobes. Foliage should feel abundant but never a uniform noise texture. Some leaves catch the sun, others turn edge-on or show pale undersides.
Edges: 5–7 slender leafy strands hang in unequal loose curtains from ledges, with exposed lengths of runner between leaves. Four runners escape onto the sand for 0.4–0.8 m in asymmetric curves with small growing tips. Three small muted pale-lilac trumpet flowers, subtle accents, not a flowering ornamental bush.
Material and light: natural realistic leaf surfaces, soft waxy highlights without plastic shine, finely striated vine stems, pale gritty rubble and sand. Warm angled afternoon sunlight, soft sky illumination in shadow, restrained rich greens and limestone cream. Sharp subject detail, realistic high-end real-time render, chunky readable vegetation that can be repeated hundreds of times.
Production constraint: buildable using a small atlas of leaf sprays and hanging strands laid over a simple irregular mound, plus a few thin cylindrical runners. Prioritize legible leaf and spray outlines and asymmetry. No furry tiny foliage, moss-ball shape, clipped topiary, manicured garden, tree crown, text, labels, characters, animals, tools or outside visual imitation. Work from these words alone.
```

## 04 — creeper.png

Output: `creeper.png`

Inputs, in order: `round1/03_creeper_initial.png`.

Review: Selected: broader vine blanket, three unequal shoulders and clear trailing runners.

Exact prompt:

```text
Use case: precise-object-edit.
Input image 1: original creeper concept, edit target.
Keep the excellent realistic heart-shaped and occasional lobed leaves, readable slender runners, leaf age variation, pale-lilac trumpet flowers, trailing ground runners, sandy coast, materials and warm afternoon light. Keep eye-height three-quarter framing and the complete plant within the image.
Refine only the mound's growth silhouette and coverage: the current central peak feels too much like a little rocky mountain. Make a LOWER, WIDER, LUMPY BLANKET, 1.0 m tall by 2.6 m wide: three unequal rounded shoulders with a shallow saddle between them, tallest shoulder well off-center. Vines smother about 85 percent of the support, with just a few small chalky rubble glimpses in deep gaps. Remove the upright bare sticks poking above the plant. Lay additional distinct 5–9-leaf sprays diagonally over the crown and shoulders, with little spaces between leaves; make them bridge across some exposed rock. Keep long visible runners between the foliage sprays and several open shadow pockets so the plant remains buildable from a few flat spray cards.
Keep the front edge RAGGED: five hanging leafy runners of unequal lengths in loose curtains, and four slender outward-growing ground runners in different directions. Preserve asymmetry; avoid a dome, hedge, bush, solid green surface or texture noise. Natural matte rich green leaves 5–15 cm, tiny yellow-green tips, a few small holes; only three pale-lilac trumpet flowers. Maintain a crisp silhouette, very realistic foliage and chalky ground. Largest native landscape resolution supported, preferably 3840x2160. No text, labels, panels, people or tools.
```

## 05 — round1/05_undergrowth_initial.png

Output: `round1/05_undergrowth_initial.png`

Inputs, in order: `seagrape.png`, `creeper.png`.

Review: Archived: flowers too prominent; planting needed more interweaving and continuation.

Exact prompt:

```text
Use case: stylized-concept.
Asset type: master environment benchmark for original coastal survival-game undergrowth.
Input image 1: original sea grape design, botanical and material reference. Input image 2: original creeper design, botanical and material reference. Use these plant designs in a NEW environment composition. Do not copy their backgrounds.
One finished, photorealistic high-end modern survival-game still at maximum visual quality, largest native landscape resolution supported, preferably 3840x2160. No graphic layout, titles, interface or people.
Scene: the edge of a warm subtropical bay, centuries after a modern coastal city was abandoned. Camera at standing eye height 1.7 m, about 8 m from the foot of a broken pale limestone wall. A cracked asphalt street and its fragmented concrete curb curve past the wall toward a glimpse of blue-green bay. The limestone wall is low and ruined, irregular broken top, weathered blockwork and remnants of simple concrete coping, not a castle or ancient temple. A shadowed opening beyond the wall and the half-reclaimed street create an inviting route a player could walk and explore. Subtle palms, hanging fig roots and distant mangrove fringe, a few modern concrete ruin silhouettes in humid distance. Keep architecture subordinate to the living ground layer.
Plant composition must make SIX different botanical silhouettes legible together, naturally intermingled rather than planted in a formal row:
1. A lush asymmetrical creeper mound heaped against the wall's foot and scrambling 1.6 m up its broken corner, 2.7 m across. Match reference 2: heart-shaped/lobed matte leaves grouped in clear sprays along thin runners, lumpy shoulders, shadow pockets, ragged hanging curtains, runners spilling onto the pavement, only a few pale lilac trumpet flowers.
2. A low open sea grape at the sunny sandy waterward edge, 1.5 m tall, 2.8 m wide. Match reference 1: big circular leathery single leaves, crooked smooth grey-brown branches visible through gaps, several red-orange old leaves and loose narrow dangling green-to-purple fruit racemes. This is a broad shrub, never a tall tree.
3. A knee-to-waist high saw palmetto clump, with unmistakable radial segmented fan fronds on long narrow petioles, low trunk hidden; do not give it feather-palm leaves.
4. An arching fern clump in cool shade directly beside the wall: clearly pinnate feathery fronds, fresh lighter tips, distinct from the palmetto fans.
5. Loose straw-and-green coastal grasses rooted in cracks and sandy gaps, varied lengths and sparse seedheads.
6. A rounded berry bush beside the broken curb, about 1.1 m high: small dark green subtly glossy oval leaves, clusters of small RED berries carried on its outside; distinct from the large matte round sea grape leaves and purple grape clusters.
The undergrowth continues in smaller repeated irregular patches along the street and shore. Plants carpet the ground between ruins, not isolated ornamental specimen beds. Leave a narrow traversable broken-street opening with sand and leaf litter.
Lighting and material: angled warm afternoon sunlight catching leaf edges, soft blue sky fill preserving shaded fern detail, a humid luminous distance, limestone cream, warm grey asphalt, rich varied natural greens, dusty orange-red accents and muted turquoise water. Realistic leaves, rough porous stone, fractured aggregate and sand. Deep useful scene focus, no excessive blur or gold color filter.
Production readability: chunky individual leaves and coherent sprays, distinct negative spaces, visible sea grape branches and creeper runners; no tiny uniform procedural foliage noise, no plastic shine, no stylized painting or cartoon. Beauty through plant arrangement, scale, depth and light. Work only from the written brief and the two original project plant images; do not imitate any existing game or external picture.
```

## 06 — undergrowth.png

Output: `undergrowth.png`

Inputs, in order: `round1/05_undergrowth_initial.png`.

Review: Selected: smaller flowers, extra ground runners and young plants, clearer shoreline route.

Exact prompt:

```text
Use case: precise-object-edit.
Input image 1 is the original undergrowth benchmark, edit target. Preserve its composition, plant locations, readable sea grape branches, creeper mound, saw palmetto fans, fern in the wall's shade, red-berried shrub, fractured road, fig roots, bay and modern concrete ruins. Preserve the realistic finished-game rendering and warm afternoon sunlight with soft shadow fill.
Refine the scene into more convincing untended undergrowth: reduce the three creeper trumpet flowers to HALF their current diameter, small pale dusty-lilac accents with visible narrow tubes rather than large ornamental blooms. Add a few separate creeper runners threading between the shaded fern and the grasses, plus one low young creeper patch beside the far curb. Include two small young sea grape shrubs spaced irregularly behind and to the side of the main waterward sea grape, with round leaves still clearly bigger than the berry bush's small leaves. Preserve the open branch windows on the main sea grape. Extend the sense of an explorable route: a narrow glimpse of the cracked street bends out of sight along the shoreline behind the palmetto, partly obscured by grasses.
Keep plant boundaries irregular and partly interwoven, with natural bare sandy gaps, not formal garden beds. Do not fill the clear broken-street foreground with a wall of foliage. Do not increase foliage microtexture or hide the six recognizable plant silhouettes. Camera remains standing eye height, scene of the wall foot and waterward plants viewed from about 8 m. Largest native landscape resolution available, preferably 3840x2160. No text, interface, people, animals or tools.
```

## 07 — seagrape_individuals.png

Output: `seagrape_individuals.png`

Inputs, in order: `seagrape.png`.

Review: Selected: three distinct growth frames at a shared scale.

Exact prompt:

```text
Use case: stylized-concept.
Asset type: sea grape individual variation lineup for a 3D artist.
Input image 1 is the approved original sea grape botanical/material reference, not a background to reproduce.
Create ONE wide landscape finished-game realistic image at the largest native resolution supported, preferably 3840x2160, showing EXACTLY THREE DIFFERENT sea grape shrubs side by side on a continuous level strip of pale sand with a few small concrete fragments. Entire plants, roots, shadows and lateral branches in frame, generous spaces between their silhouettes. No labels, letters, dividers, panels or people.
Camera: standing eye height 1.7 m, look approximately horizontally at three-quarter plant views. Move back enough to fit all three without cropping or wide-angle distortion, about 8 m. All three stand on the SAME ground baseline and use the SAME world scale. Quiet softly detailed sandy shore background and distant bay horizon, no other foreground vegetation.
Left, YOUNG: 1.2 m tall, 2 m wide. Three slender crooked basal stems form an open low fork with a higher shoulder on the right, about 40 individual circular leaves, mostly small fresh green leaves but a few large mature 20 cm leaves. One tiny green fruit raceme. Sparse, searching growth, not a miniature copy of the mature plant.
Center, MATURE: 1.65 m tall, 2.6 m wide. Five smooth grey-brown stems branch low into three unequal open fans. About 90–110 single round leathery leaves, 12–25 cm across, dull olive mature leaves and smaller lime tips, pale and red veins, 4 red-orange old leaves. Four slender loose dangling fruit racemes grading green to dusty purple. Branch paths remain visible through irregular leaf windows.
Right, OLD AND SPRAWLING: 1.35 m tall, 3 m wide. Six thicker crooked low stems, one long nearly horizontal branch reaching outward, weathered asymmetrical framework, a gap where a limb broke long ago, about 100–120 readable individual leaves, 7 scattered red-orange old leaves and a few small insect holes. Five loose narrow fruit racemes. Low and wind-shaped, with a low peripheral branch almost touching the sand. Never a bonsai trunk or dense hedge.
Use the reference's material language: leathery nearly circular flat/lightly cupped leaves on short petioles, smooth grey-brown branches, thin dangling fruit stalks with small separated berries. Make every individual structurally different, not a rescale or mirrored duplicate. These are buildable from the SAME small single-leaf atlas and fruit cluster on three simple branching frames.
Warm angled afternoon sun, soft sky-filled shadows, natural color, high-end survival-game realism, clearly readable outlines and all three plants sharp. No cartoon, plastic gloss, vegetation noise, ornamental pruning or outside imagery.
```

## 08 — round1/08_seagrape_cut_splintered.png

Output: `round1/08_seagrape_cut_splintered.png`

Inputs, in order: `seagrape.png`.

Review: Archived: pale fibers at nearly every broken twig created artificial starburst shapes.

Exact prompt:

```text
Use case: precise-object-edit.
Asset type: harvested state of the approved sea grape, for direct comparison and a buildable game asset.
Input image 1 is the exact edit target. Keep the camera, plant scale, exact major branch geometry and positions, shoreline background, ground, concrete fragments, sunlight direction and image composition unchanged.
Show this SAME living sea grape immediately after a survivor harvested it by hand and broke off twigs. Remove about 85–90 percent of its attached leaves and ALL its fruit clusters, leaving only 10–14 scattered attached round leaves, mostly in awkward-to-reach outer tips and low crevices. A couple of remaining old orange leaves and a small green shoot are enough to retain identity. Keep the long low right branch and the offset left crown skeleton recognizable. Expose the simple smooth grey-brown branch framework now clearly visible throughout.
Small twigs have been snapped unevenly, with pale freshly exposed fibrous ends, a few short dangling split twigs and stripped petiole scars; main basal branches still alive and standing. No clean saw cuts, felled trunk, axe, person or machine. Do not make it an ancient dead tree.
On the sand beneath it place 8–12 separate torn green/red leaves and leaf fragments, two short broken leafy twigs, and a few tiny empty fruit stalks. Irregular scattered harvest debris, not an enormous leaf pile. Keep the same ground-runner vegetation and rubble in the background.
Photorealistic finished survival-game material quality, warm afternoon angled light and soft sky shadows. Highest native landscape resolution available, preferably 3840x2160. Crisp clear outlines, no text, annotations, panels or interface.
```

## 09 — seagrape_cut.png

Output: `seagrape_cut.png`

Inputs, in order: `round1/08_seagrape_cut_splintered.png`.

Review: Selected: reduced break exaggeration, preserved recognizably harvested framework.

Exact prompt:

```text
Use case: precise-object-edit.
Input image 1: harvested sea grape, edit target.
Correct ONLY the exaggerated break treatment on the twig ends. The current pale starburst-like tufts at almost every twig end look artificial. Remove ALL the radiating straw or starburst fibers. Most twig tips should be naturally tapered and bare, or have a modest small petiole scar. Only 6–8 twigs should visibly be freshly snapped, with short irregular pale wood ends, one or two tiny split fibers held close to the stem, and one small partly broken twig hanging downward. No sawed round discs and no spikes.
Preserve everything else exactly: low sprawling branch framework, remaining sparse green and orange round leaves, harvest litter on the sand, empty fruit stalks, original beach and concrete rubble, camera, composition, realistic material treatment and afternoon lighting. It must still read as recently harvested, not dead or pruned ornamentally. Largest native landscape resolution supported, preferably 3840x2160, no text or overlays.
```

## 10 — seagrape_parts.png

Output: `seagrape_parts.png`

Inputs, in order: `seagrape.png`.

Review: Selected: five separate leaf types and one slender fruit cluster on grey.

Exact prompt:

```text
Use case: scientific-educational.
Asset type: realistic sea grape cut-out element sheet for building a game plant, no annotations.
Input image 1: approved original sea grape, use ONLY for botanical design, color and surface-material consistency.
Create a clean flat element sheet at the largest native resolution supported, landscape preferably 3840x2160. Exactly SIX isolated items on a completely uniform plain neutral medium-grey background (#808080), with generous grey gutters between every item. They do not touch, overlap, cast shadows on the background, or leave the canvas. No plant, branches, ground, scenic background, text, numbers, borders or watermarks.
Orthographic view STRAIGHT ON to the broad surface of each leaf. All leaves laid flat, entire outline visible, including a short petiole. Realistic leathery surface and delicate vein texture; no diagram lines or painted brushwork. Each leaf has its own short stalk pointing generally downward and a nearly circular, broad whole margin, slightly uneven in a natural way but NOT jagged, oak-lobed or deeply scalloped. Rounded tip. Soft broad frontal illumination, very subtle warm upper-left lighting and soft fill; no hard baked-in shadows, no gloss.
Two loose rows of three separate items, consistent physical scale:
Top left: one young yellow-green leaf, 12 cm across, fresh soft surface, fine pale veins, short slim pink-green petiole.
Top middle: one mature olive-green leaf, 24 cm across, mostly round, broad subtly leathery surface, pale central vein and fine branching side veins, small natural edge waviness.
Top right: one mature green leaf, 22 cm across, with a clearly readable muted coral-red midrib and reddish branching veins, short reddish petiole.
Bottom left: one old red-orange leaf, 20 cm across, patches of copper orange and warm crimson with a few residual olive areas, fine red veins, not dried and crumpled.
Bottom middle: one green weathered leaf, 20 cm across, with three small irregular insect holes and one small edge bite; holes show exactly the same neutral grey as the background, no lace skeleton, no giant missing sections.
Bottom right: ONE loose slender hanging fruit raceme 28 cm long. A thin curved olive-brown stalk with 18–22 small separate round berries attached on short side pedicels, green at the top through muted rose to dusty purple near the bottom. Narrow airy bunch, clearly visible connecting stalks and gaps, not a dense table-grape bunch. No leaf attached to the fruit cluster.
This is a realistic high-end game plant atlas CONCEPT: clean separable silhouettes, physically credible color and veins, readable at modest texture resolution. The beauty belongs to the actual leaf shapes rather than texture noise. Produce only these six original elements from the written description and original project reference.
```

## 11 — creeper_individuals.png

Output: `creeper_individuals.png`

Inputs, in order: `creeper.png`.

Review: Selected: young, mature and old masses differ in support and runner arrangement.

Exact prompt:

```text
Use case: stylized-concept.
Asset type: creeper individual variation lineup for a 3D artist.
Input image 1: the approved original freestanding creeper, reference for foliage, runner construction, color, material and light.
Create ONE wide realistic finished-game image at the largest native landscape resolution available, preferably 3840x2160, showing EXACTLY THREE DISTINCT creeper mounds SIDE BY SIDE, separated by clear sandy gaps. No collages, panels, words, labels or dividers. Continuous flat sandy ground with small rubble, restrained bay and ruined coastal-city background.
Camera at standing eye height 1.7 m, pulled back enough to see all three complete masses and ALL their trailing ground runners. Three-quarter perspective, same ground baseline and same world scale. No individual crops or close-up insets. All three in focus.
Left YOUNG: a low 0.6 m high by 1.5 m wide two-lobed patch over a small broken slab. About 10–14 leafy sprays, each with 5–8 heart-shaped leaves, clear exposed runners bridging small gaps, a few visible chalky support corners, many small young leaves. Two delicate short strands and three runners creeping across sand. One very small pale lilac trumpet.
Center MATURE: 1.1 m tall by 2.3 m wide, three unequal soft shoulders over rubble, about 24–30 overlapping sprays. A broad lumpy blanket of matte mid-green heart-shaped and occasional shallow-lobed leaves 5–15 cm long. Distinct diagonal runner routes and dark pockets between sprays. Five hanging strands of unequal length, three longer ground runners, two small pale lilac trumpet flowers. At least 85 percent of support covered.
Right OLD/SPRAWLING: 1.45 m tall by 3 m wide over a collapsed dead shrub and low rubble, tallest shoulder off-center and a long low sideways spill. About 34–42 sprays, more long olive-brown runner segments visible, several yellowing leaves and small insect bites, eight uneven trailing strands, long runners extending outward along the ground. A sagging gap makes its silhouette irregular; no upright bare sticks poking above its crown. Three tiny lilac trumpets, never a flowering bush.
The individual silhouettes must differ in actual support arrangement and runner layout, not be scaled clones. All are VINES DRAPED OVER SUPPORT, never self-supporting woody shrubs or green domes. Single readable leaf outlines inside coherent sprays, ragged loose edges, natural asymmetry, no uniform foliage texture.
Warm angled afternoon sun, soft skylight in shadows, realistic matte foliage and chalky rubble. High-end modern survival-game visual quality, chunky legible shapes that remain identifiable at distance, no plastic gloss, cartoon, moss-ball shapes, people or tools.
```

## 12 — creeper_cut.png

Output: `creeper_cut.png`

Inputs, in order: `creeper.png`.

Review: Selected: exposed support, interrupted runners and scattered harvest debris.

Exact prompt:

```text
Use case: precise-object-edit.
Asset type: harvested state of the approved creeper, buildable game-plant concept.
Input image 1 is the exact edit target. Keep the camera, overall footprint, three unequal support shoulders, sand, concrete fragments, shoreline background, sunlight and framing unchanged.
Show this SAME creeper immediately after a survivor tore most of its vines away for fibre. About 70–80 percent of the foliage is removed. Expose the previously hidden low rubble mound and some thin dead shrub branches inside it; rough pale limestone and broken concrete in the same three-lobed support arrangement. It must remain a low broad mound, not turn into a large tree stump or a new rock mountain.
Remaining foliage: four irregular islands of attached 5–8-leaf sprays clinging to the far shoulder, side crevices and near the base, about 25–35 attached leaves total, matte green heart-shaped leaves and occasional shallow lobes 5–15 cm. One tiny pale-lilac trumpet may remain tucked at an edge.
Visible damage: long olive-brown runners torn across the face and hanging slack in loose uneven lengths, some dangling with just one or two leaves. Broken ends small and subtly frayed, not explosive starbursts. A formerly connected vine now hangs loose across a bare rubble face. Ground runners have been ripped back and interrupted, with two visibly broken lengths beside the plant, one still rooted small fresh tip.
Scattered on the sand at the front: 8–12 torn or detached heart-shaped leaves, several short cut spray pieces and two loose bent runner lengths, spread irregularly rather than piled. No person, tool, footprints, axe, saw, blood or fire. It must read as harvested living vegetation, not fully dead or merely autumnal.
Keep realistic high-end survival-game materials and warm angled afternoon sun with soft skylight in the shadows. Clear readable damage and runner attachment, no uniform tangle or dense twig noise. Largest native landscape resolution available, preferably 3840x2160. No text, panels, labels or UI.
```

## 13 — creeper_parts.png

Output: `creeper_parts.png`

Inputs, in order: `creeper.png`.

Review: Selected: three distinct open sprays and one long strand on grey.

Exact prompt:

```text
Use case: scientific-educational.
Asset type: realistic creeper cut-out element sheet for a game vegetation artist.
Input image 1: original approved creeper, use only for the botanical design, matte leaf material, runner color and muted lilac flower.
Create an orthographic flat-lay element sheet with exactly FOUR separated assets: THREE DIFFERENT LEAFY SPRAYS on their runners, and ONE LONG HANGING STRAND. Largest native landscape resolution supported, preferably 3840x2160. Uniform plain neutral medium-grey background (#808080). No scenery, supporting mound, labels, text, numbers, dividers, drop shadows, watermark or tools.
The whole silhouette of each asset and all its runner tips must be inside the canvas with generous grey margins; assets never touch one another. Leaves lie approximately in the image plane and face the viewer straight on. Fine realistic leaf surface and delicate veins, restrained matte greens, soft diffuse frontal illumination with faint warm upper-left modeling, no hard baked shadows or glossy shine. Clearly visible slender olive-green to brown stems connect EVERY leaf by a short petiole.
Layout: two shorter sprays across the upper left and upper middle; one wider diagonal spray below them; a single long hanging strand occupies the rightmost quarter from near top to near bottom.
Spray A, upper left: an open curved 35 cm runner bearing FIVE heart-shaped leaves, each 7–12 cm, clear basal notches and pointed tips, varied leaf angles IN THE PLANE, younger brighter pair near the growing end. Every leaf has its own recognizable edge with small grey gaps.
Spray B, upper middle: a lightly forked 45 cm runner bearing SEVEN leaves, four heart-shaped and three shallow three-lobed, 8–15 cm, rich mature mid-green with one paler underside-facing leaf. Balanced open branching, never a clump of overlapping leaf texture.
Spray C, lower left/center: a sideways branching 50 cm spray with SIX leaves, a mix of mature heart-shaped leaves and small fresh tips, one yellowing leaf and one leaf with two small irregular insect holes. ONE small dusty pale-lilac trumpet flower about 3 cm diameter on a short side stem, seen at a slight angle so its funnel tube is visible. The flower is a subtle accent, not the size of a leaf. Keep generous space between leaves.
Strand D, right: one slender 75 cm runner hanging in a relaxed asymmetric S curve with EIGHT alternating leaves on short petioles, irregularly spaced, larger near the upper third and smaller toward the slender tip. A few bare stretches of runner make the curtain airy; at most one small side shoot, no dense vine rope. The strand is laid flat for cutting out, with all leaves largely face-on.
Botanical identity: heart-shaped or gently lobed creeper leaves, 5–15 cm, natural notched bases, pointed tips; not sea grape discs, maple leaves, fern fronds, ivy wallpaper or grapes. Readable coherent sprays that can be repeated over an irregular mound and hung from ledges. Original realistic production concept, not a stylized illustration or copied reference.
```

## 14 — round1/14_creeper_wall_tight.png

Output: `round1/14_creeper_wall_tight.png`

Inputs, in order: `creeper.png`, `undergrowth.png`.

Review: Archived: inadequate margin around the left ground runner.

Exact prompt:

```text
Use case: stylized-concept.
Asset type: creeper wall-placement concept, same plant kit as freestanding version.
Input image 1: original approved freestanding creeper, botanical/material/runner reference. Input image 2: original undergrowth benchmark, limestone, road and lighting reference. Create a NEW single-plant view, not a collage or crop of either image.
One photorealistic high-end modern survival-game still at the largest native landscape resolution supported, preferably 3840x2160. Whole creeper plant and ALL its trailing runners clearly visible. No text, labels, interface or people.
Scene: a ruined pale limestone wall at the edge of a cracked street near a warm bay. Large weathered porous limestone blocks with broken concrete coping, a few fallen blocks piled at the foot, sand drifting over the cracked asphalt. A subtle bay glimpse and distant palms at one edge. Architecture simple and believable for an abandoned modern coastal city, not castle ruins.
Camera: three-quarter view from about 3.5 m at standing eye height 1.7 m, showing the wall face and its broken end returning in depth. Focus on one creeper mass heaped against the foot; wall may extend beyond frame but the plant must not be cropped.
Plant: a 2.7 m wide vine blanket at the base, covering low rubble in three unequal rounded lobes, with one off-center shoulder rising and scrambling 1.7 m up the limestone at a broken corner. It must look physically supported by rubble and wall, not a tall freestanding leafy bush leaned against a backdrop. The foliage clings into joints, runners visibly turn over one projecting ledge, and six loose leafy strands hang down its face in unequal curtains. Base merges into a low broad side-spill, with four thin ground runners reaching 0.4–0.8 m over sand and asphalt.
Use the SAME leaf spray construction as reference 1: matte heart-shaped leaves with some shallow three-lobed leaves, 5–15 cm, grouped in 5–9-leaf sprays along visible olive-brown runners; small fresh yellow-green tips, several darker old leaves, two yellow leaves, a few subtle insect bites. Distinct individual outlines and gaps, dark pockets between overlapping sprays, asymmetrical placement. Cover about 85 percent of the basal rubble but leave several chalky support glimpses. Show some exposed climbing runners above and beside the foliage, no blanket of tiny leaves.
Only three small muted pale-lilac trumpet flowers, much smaller than a mature leaf. No blossoms carpeting the plant. Warm angled afternoon sunlight rakes across the wall and leaf edges; soft cool sky illumination preserves shaded leaf detail. Natural rich green, warm limestone cream, grey asphalt and sand; realistic materials, matte foliage, no plastic shine. Strong lumpy, ragged silhouette that reads from far away and can be built from three spray cards, a hanging strand and simple runner stems. Original imagery only.
```

## 15 — creeper_wall.png

Output: `creeper_wall.png`

Inputs, in order: `round1/14_creeper_wall_tight.png`.

Review: Selected: complete runner tips and comfortable framing.

Exact prompt:

```text
Use case: precise-object-edit.
Input image 1 is the original creeper-at-wall concept, edit target.
Preserve this exact plant design, the supporting limestone wall, runner routes, leaf shapes and materials, three small lilac flowers, warm afternoon sunlight and soft sky fill. This is a framing correction for the 3D artist.
Pull the camera back about 12 percent while keeping eye height 1.7 m and the same three-quarter angle. Show a clear margin of sandy cracked pavement on both sides and below the WHOLE creeper, including the complete leftmost ground runner and its growing tip. No leaf or runner belonging to the featured plant may touch or cross the frame edge. The plant should still occupy most of the frame, and the wall may continue out of frame. Keep the background quiet and do not introduce new foreground plants.
Maintain the lumpy blanket shape at the wall foot, offset climbing shoulder, loose hanging strands, small chalky support glimpses and visible attachment to wall joints. Keep finished high-end survival-game realism and sharp plant detail. Largest native landscape resolution available, preferably 3840x2160. No text, labels, borders, UI or people.
```
