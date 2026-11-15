# Broadleaf trees — coastal city hammock

Fifteen original paintings for a ruined subtropical city on a bay. The design language is a pale, rounded strangler fig; a low mangrove standing on curved roots; a dark, spreading oak with visible elbows; and a banyan whose broad roof rests on separate pale root-pillars. Warm afternoon light reveals the structures, while cool sky light keeps their undersides readable.

The paintings establish shape, material and character. The dimensions below are the construction targets: the painted perspective, human figures and foliage edges are visual guides, not orthographic measurements. Use the leaf sheet's centimetre dimensions for leaf assets, rather than estimating leaf size from a whole-tree painting.

## Picture index

| File | Purpose | Native pixels | Selected painting |
| --- | --- | --- | --- |
| [fig_lineup.png](fig_lineup.png) | F01–F03, left to right | 2172 × 724 | v3 |
| [fig_trunk.png](fig_trunk.png) | F02 fused root wall and swallowed column | 1448 × 1086 | v1 |
| [mangrove_lineup.png](mangrove_lineup.png) | M01–M04, left to right | 2172 × 724 | v2 |
| [oak_lineup.png](oak_lineup.png) | O01–O03, left to right | 2172 × 724 | v2 |
| [oak_trunk.png](oak_trunk.png) | O02 fork, bark, fern and moss | 1448 × 1086 | v1 |
| [stumps.png](stumps.png) | Fig, mangrove, oak, left to right | 1774 × 887 | v2 |
| [hammock_near.png](hammock_near.png) | Standing player's view along the shore | 1672 × 941 | v1 |
| [hammock_far.png](hammock_far.png) | Approximately 400 m across the bay | 1672 × 941 | v2 |
| [hammock_far_flat.png](hammock_far_flat.png) | Same composition simplified into coloured volumes | 1672 × 941 | v2 |
| [leaves.png](leaves.png) | Five measured foliage/root samples | 1536 × 1024 | v2 |
| [banyan_lineup.png](banyan_lineup.png) | B1–B3, left to right; 1.8 m person | 2172 × 724 | v4 |
| [banyan_hall.png](banyan_hall.png) | Player's view inside B1's living colonnade | 1672 × 941 | v1 |
| [banyan_far.png](banyan_far.png) | Three banyans added to the approximately 400 m hammock view | 1672 × 941 | v1 |
| [banyan_far_flat.png](banyan_far_flat.png) | Same banyan locations as flat-colour low-poly volumes | 1672 × 941 | v1 |
| [banyan_stump.png](banyan_stump.png) | B1 main stump and all nine pillar stumps | 1672 × 941 | v2 |

These are the full native PNGs returned by the built-in image tool, without resizing, cropping, sharpening or upscaling. Larger sizes were requested in the prompts; the table records what the tool actually returned. All 27 generated versions, including twelve superseded paintings, are preserved in `source/`: eighteen from the original set and nine from the banyan round. Exact prompts and image-input relationships are in [prompts.md](prompts.md).

## Shared construction rules

Work in metres, with the origin at the centre of the trunk's ground contact and the vertical axis up. Height includes foliage; crown width means maximum horizontal spread. Trunk diameter is the harvestable stem at about 1.3 m, excluding dangling fibres and embedded city objects.

Fig and oak use a simple 1–2 m diameter harvest post. Their thick basal roots remain close to this post: prefer 0.3–0.6 m beyond the bark, with an absolute limit of 1 m. Let them descend rapidly into the ground. Do not extend a broad solid apron beneath the entire crown. The mangrove is the exception: treat its compact cage as one solid collision volume, with every root inside a 1.5 m horizontal radius from the base centreline.

Keep the lowest substantial outboard limb at least 2.3 m above the local walkable ground. Ground-following placement must preserve this clearance. Passable aerial roots are generally 0.5–2 cm thick, occasionally up to 5 cm; leaves and moss are also passable. The strangler fig, oak and mangrove individuals have no satellite root-pillars: do not add thick grounded hanging roots away from their harvest post or compact mangrove cage. The banyan deliberately uses separate grounded pillars with individual collision posts, as specified below.

Every tree must work through a full rotation. Distribute scaffold limbs around the stem, perturb their azimuths and elevations, and avoid arranging all forks in the plane shown by the painting. Keep one expressive asymmetry, with supporting branches behind it. Crown depth should be 75–100% of its maximum width. Embed the swallowed object inside the fig's central volume; reveal it through different small windows on at least two sides.

Use hierarchical foliage: a few large crown lobes establish the silhouette, smaller twig/card groups break their edges, and individual leaves supply close detail. The lobe counts below describe three-dimensional masses, including the hidden rear of the tree. Maintain several broad sightlines through the scaffold. A thousand tiny holes cannot replace a few useful sky windows.

Choose an individual first, then vary it. Keep height, crown spread and trunk diameter inside the species ranges rather than scaling every part by the same unconstrained factor. Independently vary lobe size by about 15%, limb directions by 10–20 degrees, and the position of a lost limb. Preserve the root footprint, player clearance and leaf dimensions after variation. Rotate the whole tree freely; orient a leaning mangrove toward water when placing it.

## Strangler fig

### Individuals and proportions

| Individual | Height | Crown width | Stem diameter | Life history and ground |
| --- | --- | --- | --- | --- |
| F01 — pole fig | 16 m | 21 m | 1.6 m | A chipped concrete utility pole remains inside two narrow vertical root windows. Left shoulder of crown is higher; an old scaffold break makes a notch. Cracked plaza paving. |
| F02 — portico fig | 18 m | 24 m | 1.9 m | A 0.4–0.5 m square portico column survives inside the root wall; a fragment of its capital appears near the first fork. Broadest dome, longer right scaffold. Broken concrete around a compact foot. |
| F03 — sign fig | 14 m | 18 m | 1.4 m | A corroded street-sign post and small sign blade remain visible at roughly 2–2.5 m. Upper stem leans, one lost limb opens a sky window. Flat paving with thin soil in joints. |

Overall range: **14–18 m high, 18–24 m wide, 1.4–1.9 m stem diameter**. F02 is the main construction reference. Its ground footprint is about 2.7 m across; F01 and F03 can be 2.2–2.5 m.

Build the lower stem from 8–12 unequal descending root ribbons, approximately 0.12–0.35 m thick where visible. Broad surfaces fuse together; keep only 2–4 deep windows onto the swallowed object and several shallow seams. Most roots run downward with occasional diagonals. Avoid a uniform spiral braid. The close-up shows the mature fused surface; the lineup shows the remaining skeletal channels.

At 3.5–5 m, develop **4–6 main scaffold limbs**, 0.35–0.65 m thick near their origins. They travel mainly outward, initially 10–30 degrees above horizontal, then lift near their ends. Each divides into 2–3 secondary branches; subordinate twigs carry the foliage. Taper each order visibly. Avoid a vertical central spire.

Use **10–14 major crown lobes**, generally 4–7 m wide, 3–5 m deep and 2–4 m tall, overlapping to form a broad dark dome. Subdivide them into roughly 60–100 twig/card groups, 0.6–1.6 m across. These counts are art targets for organising the crown, not a triangle budget. Leave 3–5 substantial sky channels between the main limb fans and irregular notches along the underside.

Hang 20–45 fine aerial-root strands in 4–7 uneven groups under the large branches. Lengths vary from 1 to 5 m; most stop well above the ground. Allow a few longer fine strands near the trunk. Keep their distribution patchy so they do not become a vertical fence. Embedded concrete and metal belong to the central stem and survive in the stump.

**At 3 m:** smooth pale living volumes visibly fuse around an angular dead city fragment. Root seams, concrete windows and thin aerial roots distinguish the tree before the player sees its leaves.

**At 500 m:** retain the broad dark dome, pale narrow stem and pale lateral fork. Combine small leaf groups into 4–6 major lobes; preserve an asymmetric shoulder and one underside opening. The aerial roots and swallowed object can disappear. The fig must remain identifiable without them.

## Red mangrove

### Individuals and proportions

| Individual | Height | Crown width | Stem diameter | Root structure and situation |
| --- | --- | --- | --- | --- |
| M01 — young | 5 m | 5 m | 0.30 m | 7 principal prop roots; 2.0–2.2 m cage width. Sparse crooked upper branches over a mudflat. |
| M02 — rounded | 6.5 m | 6.4 m | 0.45 m | 9 principal roots; 2.4–2.6 m cage. Upright, rounded crown at the edge of a shallow pool. |
| M03 — water lean | 7 m | 7.4 m | 0.50 m | 9 principal roots; 2.6–2.8 m cage. Upper trunk leans about 18 degrees over the water; stronger landward supports remain inside the footprint. |
| M04 — old | 8 m | 8 m | 0.65 m | 11 principal roots; 2.8–3.0 m cage. An old broken limb and a few dangling aerial roots. Wet shoreline mud. |

Overall range: **5–8 m high, 5–8 m wide, 0.30–0.65 m stem diameter**. The root cage is much narrower than the crown. Do not widen it in proportion to an enlarged crown.

Root shoulders occupy approximately the lowest 1–2 m. Each prop root begins at the stem, curves outward, then bends downward into mud. Make the curvature continuous and loaded, with 0.08–0.18 m main root diameters and fewer, thinner secondary forks. Use unequal arcs and imperfect spacing around the whole trunk. Near and far arches overlap without filling the interior solidly. The standing tree is visually hollow even though its gameplay collider fills the cage.

Above the cage, a short crooked trunk divides into **3–5 main limbs**, with 2–3 unequal secondary branches each. M03's upper mass extends waterward while its root base stays compact. Use **5–9 crown lobes**, 1.3–3 m across and 0.8–1.8 m tall, containing approximately 24–50 twig/card groups of 0.35–0.9 m. Older individuals have more lobes and a denser crown; M01 retains the largest gaps. Keep the silhouette low and rounded rather than pointed.

Wet root bases have a dark grey-brown band 0.15–0.35 m high, following the water level rather than the root's local axis. Upper bark stays pale grey-brown. Gloss is strongest on the leaves and wet lower roots. Use small patches of yellow-green new growth and a few brown leaves, not a yellow outer crown. M04 has 3–5 slender hanging roots, generally 0.5–1.5 m long.

**At 3 m:** curved arches, overlapping legs, the open cavity and the wet/dry boundary are the primary recognition cues. The leaves have smooth, thick elliptic blades and conspicuous pale midribs.

**At 500 m:** preserve a low, dark, scalloped shoreline band. Individual cages simplify to 3–5 broad arches only where exposed; most disappear in shore shadow. Keep mangroves substantially shorter than the fig and oak layer. A band of mangroves must never become a row of tall umbrella trees.

## Live oak of the hammock

### Individuals and proportions

| Individual | Height | Crown width | Stem diameter | Life history and ground |
| --- | --- | --- | --- | --- |
| O01 — low sweep | 12 m | 20 m | 1.5 m | Four great limbs from a fork near 2 m. Left limb dips to about 2.4 m clearance and turns upward. Open upper notch. Old park soil beside a broken path. |
| O02 — park elder | 16 m | 24 m | 2.0 m | Five main limbs from a fork near 2.5 m. Broad irregular tiers; fern beds above the largest branches, separated moss beards below. |
| O03 — storm survivor | 14 m | 22 m | 1.7 m | Four main limbs and a healed missing-limb collar. One long outboard elbow, returning upward; an open crown window records the loss. Slightly drier park margin. |

Overall range: **12–16 m high, 18–24 m wide, 1.5–2.0 m stem diameter**. Ground flare extends about 0.3–0.5 m outside the bark, usually giving a 2.1–3 m total footprint. Roots vanish into soil immediately beyond it.

The short trunk splits into **4–5 major limbs within 2–3 m**. Main limbs begin about 0.4–0.8 m thick, reach farther sideways than upward, and split into 2–3 secondary limbs with irregular elbow bends. Let one limb dip and recover; give another a stronger upward sweep to balance the mass. Do not mirror the branches. Bark grain follows the load-bearing wood around every bend and crotch.

Use **12–18 main foliage lobes**, approximately 3–6 m wide, 2–4 m deep and 1.5–3 m high. Arrange them at the outer branch ends as an irregular stack of shallow terraces. Subdivide into around 80–130 twig/card groups, 0.4–1.2 m across. Preserve 4–6 large sky windows and dark inner hollows. The leaves are much smaller than fig or mangrove leaves; they should not read as broad individual paddles in the whole-tree view.

Bark is dark, deeply furrowed and coarse. Build long irregular plates, roughly 5–15 cm wide, separated by deep narrow cracks; vary ridge depth and follow the stem's twist. Keep its broad value dark even when ridge edges catch warm sunlight. One healed wound per selected variant is enough.

Place **5–10 moss beards**, 0.5–1.5 m long and 0.2–0.6 m wide, beneath selected limbs. Their ends taper into airy curled filaments. Place **4–8 fern tufts** on the upper surfaces of large limbs, with individual fronds around 15–35 cm long and groups 0.3–0.8 m across. Do not coat the whole tree in either plant. Keep fern green separate from the silvery grey-green moss.

**At 3 m:** dark furrowed bark, the low structural fork, fern above and moss beneath identify the oak. The player should see both a solid harvest stem and a convincing load path into the crown.

**At 500 m:** keep the dark low fork and 4–7 wide, irregular stepped crown masses. Its top is flatter and more broken than the fig's dome. Tiny moss threads disappear; at most retain a few muted grey-green underside patches. The oak must still read from branching and silhouette alone.

## Banyan

An old fig becomes a grove without becoming several trees. One harvestable main trunk sends heavy limbs sideways; rooted aerial columns support those limbs from below. Keep the same smooth pale living wood and leathery dark leaves as the strangler fig. Its distinguishing feature is the open colonnade under a broad roof, not a different leaf colour or a mass of tangled roots.

### Individuals and proportions

| Individual | Height | Crown width × depth | Main trunk diameter | Pillars | Character and ground |
| --- | --- | --- | --- | --- | --- |
| B1 — the colonnade | 16 m | 30 × 26 m | 2.4 m | 9, diameters 0.35–0.70 m | Long, nearly level crown with several separated pale posts visible on either side of the main trunk. Old waterfront plaza; shallow paving displacement at each foot. |
| B2 — the young banyan | 14 m | 22 × 20 m | 2.0 m | 3, diameters 0.30–0.42 m | First pillars close to the main trunk, rounder crown and many unrooted curtains beneath the outer limbs. Younger in its spread, already a substantial tree. |
| B3 — the swallower | 18 m | 28 × 24 m | 2.5 m | 7, diameters 0.35–0.70 m | High eastern shoulder, broken western scaffold, and a rusted car lifted between two eastern pillars. Reclaimed roundabout or plaza edge. |

Overall range: **14–18 m high, 22–30 m across, 2–2.5 m main trunk diameter**. Diameters are measured at 1.3 m above the local ground. B1 is the structural and harvest reference. B3's rear pillar can hide behind the main trunk in the lineup; the construction has seven, even when only six are visible. The paintings establish the shapes; use these dimensions and ground plans for the model rather than deriving measurements from perspective.

### Pillar positions and load paths

The following are local directions for one unrotated tree, not world placement requirements. Origin is the main trunk's ground centre; +X is east, +Z north, and +Y up. Bearings run clockwise from north: N = 0°, E = 90°, S = 180°, W = 270°. A pillar at radius `r` and bearing `a` has ground centre `x = r sin(a), z = r cos(a)`. Heights below are measured from its own walkable ground. Rotate the complete tree and all its posts together.

Each pillar ascends almost vertically from its own ground contact to the **underside** of the named limb. Keep lateral drift below about 0.35 m over the whole pillar, with shallow fluting and a small organic swelling at the top joint. Do not turn the support into an arch, diagonal brace or independent forked sapling. The main trunk remains four to seven times thicker than a typical pillar.

| B1 pillar | Distance / direction from main trunk | Diameter | Limb underside at joint | Supporting limb |
| --- | --- | --- | --- | --- |
| P1 | 9.0 m W, 270° | 0.70 m | 6.1 m | Outer western beam |
| P2 | 7.0 m WSW, 247.5° | 0.55 m | 5.4 m | Southwest fan, outer branch |
| P3 | 5.2 m SW, 225° | 0.40 m | 5.0 m | Southwest fan, inner branch |
| P4 | 6.5 m NNW, 337.5° | 0.50 m | 6.4 m | Rear northern beam, west fork |
| P5 | 4.5 m SSE, 157.5° | 0.35 m | 4.8 m | Southern beam, inner joint |
| P6 | 8.0 m ESE, 112.5° | 0.60 m | 5.7 m | Eastern beam, south fork |
| P7 | 9.5 m ENE, 67.5° | 0.65 m | 6.3 m | Eastern beam, north fork |
| P8 | 6.8 m NNE, 22.5° | 0.42 m | 6.6 m | Rear northern beam, east fork |
| P9 | 6.8 m SE, 135° | 0.45 m | 5.3 m | Southern beam, outer fork |

**B1 limbs:** five primary scaffolds leave the main trunk at 3.8–5.2 m, initially 0.55–0.95 m thick. Send them west, southwest, south, east and north; the eastern and northern beams divide into unequal fans. They rise gently to the joints listed above, then continue beyond the supports to tapered secondary branches and lifted terminal foliage. The western beam reaches roughly 14–15 m from the origin, the eastern fan 13–15 m. Preserve continuous wood from trunk to every pillar joint; a pillar is not merely a stick disappearing into foliage. Give one upper western lobe a small notch without breaking the long horizontal roof. The nine positions produce four posts west of the main trunk and five east, with substantial depth separation rather than a literal straight fence.

| B2 pillar | Distance / direction from main trunk | Diameter | Limb underside at joint | Supporting limb |
| --- | --- | --- | --- | --- |
| P1 | 3.2 m WSW, 247.5° | 0.42 m | 4.7 m | First western scaffold |
| P2 | 3.4 m ESE, 112.5° | 0.35 m | 4.9 m | Low eastern scaffold |
| P3 | 4.0 m ENE, 67.5° | 0.30 m | 5.4 m | Rear eastern scaffold |

**B2 limbs:** four primary scaffolds, 0.45–0.75 m thick, fork from the stem at 3.6–4.8 m. The western and two eastern limbs pass through their first support stations, then run another 5–7 m outward. A northern fan remains unsupported except by the main trunk. Upper branches lift more strongly than B1's to make a rounder crown. Thin curtains beyond these three pillars describe the places where the grove could eventually expand; none is an additional grounded post in this individual.

| B3 pillar | Distance / direction from main trunk | Diameter | Limb underside at joint | Supporting limb |
| --- | --- | --- | --- | --- |
| P1 | 8.5 m WNW, 292.5° | 0.70 m | 6.0 m | Surviving western lower beam |
| P2 | 7.0 m WSW, 247.5° | 0.55 m | 5.3 m | Western lower fan |
| P3 | 4.8 m SW, 225° | 0.40 m | 5.0 m | Southwest secondary beam |
| P4 | 5.5 m N, 0° | 0.45 m | 7.0 m | Rear northern scaffold; often occluded |
| P5 | 4.8 m E, 90° | 0.60 m | 6.1 m | Eastern beam; inner car pillar |
| P6 | 8.0 m E, 90° | 0.65 m | 6.8 m | Same eastern beam; outer car pillar |
| P7 | 11.0 m ESE, 112.5° | 0.35 m | 7.3 m | Outermost eastern fan |

**B3 limbs and wreck:** four intact primary scaffolds, 0.6–1.0 m thick at their origins, begin at 4–6 m. A separate upper western scaffold ends in a 0.65 m thick broken stub around 9 m high and 5–6 m out. Preserve the lower western beam and its supports beneath this loss. The east beam runs past P5 and P6 to the fuller, taller eastern crown; P7 supports a southern fork near its outer edge. This creates a storm notch on the west without leaving a pillar attached to nothing.

The unbranded rusted compact car is about **4.0 × 1.7 × 1.4 m**, its length running east–west around centre `(6.4, 0)` in the ground plan. P5 and P6 pass through and thicken around its crushed body near opposite ends. Set the lowest chassis, loose panel or wheel remnant **2.6 m above the paving**. The roots may spread against the metal above that height, but their lower sections remain separate upright posts. An empty window and buckled roof identify the car; avoid a pristine drivable vehicle. This is a small swallowed city remnant, not the primary silhouette.

### Crown lobes, cards and hanging roots

| Individual | Major three-dimensional crown lobes | Twig/card groups | Free aerial roots |
| --- | --- | --- | --- |
| B1 | 16 shallow lobes, roughly 4–7 m wide, 3–5 m deep, 2–3.5 m tall | 100–140 groups, 0.6–1.5 m across | 35–60 strands in 5–7 patchy curtains |
| B2 | 12 fuller lobes, roughly 3.5–5.5 m wide, 3–4.5 m deep, 2.5–4 m tall | 75–105 groups, 0.6–1.4 m across | 80–120 strands in 9–12 curtains, most under the outer limbs |
| B3 | 15 unequal lobes, roughly 4–6.5 m wide, 3–5 m deep, 2–4 m tall | 95–135 groups, 0.6–1.6 m across | 40–70 strands in 6–9 curtains, sparser by the broken limb |

Counts include the unseen rear and are organisation targets, not draw-call or polygon budgets. Let B1's broad overlapping groups form a continuous shelter while keeping **5–7 major sky channels**, open underside bays and an irregular edge. B2 has 4–6 sky channels through its rounded shoulders; B3 keeps 5–7, including one large western storm gap and more densely overlapping eastern lobes. A few large openings matter more than thousands of tiny pinholes. Do not flatten the roof into one slab or scatter it into disconnected bonsai pads.

Reuse the fig twig language in [leaves.png](leaves.png): mature alternate leaves **10–14 × 5–7 cm**, smooth entire oval margins, short tips and leathery surfaces. Assemble varied twig cards into volumes with tilted upper, lateral and underside cards. Reserve identifiable individual leaves for close views; the lineup and far views should read as masses. Increase foliage overlap inside a lobe without closing the intentional channels between lobes.

Free hanging roots are generally **0.5–2 cm** thick, occasionally up to 5 cm at their attachment, and taper to fine free ends. B1 lengths are 1–5 m; B2 2–6 m; B3 1–5 m. Long ones may end 0.15–0.4 m above paving; others stop several metres up. All remain thinner than a wrist and passable. Separate curtains with broad empty bays; B2 has the most strands, not a solid screen across every route. Avoid blending intermediate thick ropes into the curtains: a rooted support belongs to the explicit pillar list and has its own post; an unrooted strand remains visibly fine. Never turn aerial roots into oak moss beards.

### Materials and player space

Use the same fig bark, leaf, aerial-root and cut-wood swatches in the material table. In particular, bark is `#A6A79C`, with warm pale patches `#C5C1AE` and cool older areas `#6E7770`; mature upper leaves are `#2E4C2C`, varying toward `#425D32`, with `#647447` undersides. Use `#887C65` on fine aerial roots. Cut wood is `#D9C392`, with `#B69A68` inner fibres and `#E7D5AE` torn edges. Pillars are living grey wood, not brown lianas. Shallow scars, a few fused seams and restrained damp staining at the feet give close detail without deep oak-like bark plates.

The swallowed car uses existing rusted-steel colours `#8C4F2E / #B5743F / #454A43`; retain tiny patches of faded muted paint. Afternoon highlights come from lighting, not orange base colours. For the flat distant study, banyan crown faces use `#5B7337 / #3F582D / #243F27` for lit, middle and shaded planes. Their slight colour difference from the fig is secondary to the roof and posts.

The **main trunk is the only harvest target**. Give every pillar its own tight collision post; do not make a single collision hull enclosing the grove. Include compact basal flare in each post footprint, with roots descending immediately into the ground. Main basal flare stays within about 0.3 m beyond the trunk bark; pillar flare within 0.1–0.15 m beyond its bark. Lift adjacent paving subtly as walkable ground, with no raised solid root bridges. Preserve at least 1.5 m clear width in intended routes between a pillar and the main trunk or its neighbour.

Every substantial limb, thick outboard root and the car stays above **2.3 m clearance measured from the highest local walking surface**; use 2.6 m or more for margin around the wreck. Only the main trunk and named pillar posts occupy the standing tree's lower solid space. Thin root curtains, leaves and moss are passed through. Ground adaptation must move pillar feet and preserve their overhead connections and clearance together. Reject a placement that creates a diagonal brace or low obstruction. Do not apply the original single-post tree rule to banyans.

### Close and distant reading

**At 3 m:** pale smooth cylinders and a much thicker fused main trunk define the room. The eye follows a pillar straight upward into the underside of a long limb and back to the parent stem. Thin backlit hanging fibres remain visibly different from those solid posts. B1 offers several routes and long open sightlines; B2 shows a few young columns surrounded by unfinished curtains; B3 pairs the high rusted wreck with a visibly damaged western scaffold. In [banyan_hall.png](banyan_hall.png), the 1.7 m eye-height camera looks from B1's shade to the bright plaza; the framing shows six secondary pillars while the other three lie outside or behind visible structure.

**At 500 m:** preserve B1's long shallow roof, 4–6 broad crown masses, one thicker central pale stem and several separated pale support marks beneath a continuous horizontal limb. B2 remains rounder but wider than a comparable single-stem fig, with two or three close pale posts; B3 retains its high eastern shoulder and missing western crown wedge. Fine roots, individual leaves, bark seams and the car can disappear. The banyan must still read without them. The fig is a dome on one pale fork; the oak has dark bent elbows beneath irregular terraces; the mangrove is the short shoreline band with compact arches.

At 1920 px and a 90° horizontal field of view, B1 at 500 m projects to roughly **31 px high × 58 px wide**; its 0.35–0.70 m pillars are only **0.7–1.3 px wide**. Preserve the rhythm of a few visible posts and gaps in the distant mesh or impostor, without turning them into thick beams. Visibility and antialiasing may hide individual rear posts. At 400 m, B1 projects to about 38 × 72 px under that same camera; the concept paintings use a tighter view to make the comparison legible. This is an art-direction study, not a calibrated engine-distance capture.

[banyan_far.png](banyan_far.png) preserves the original bay, portico, midrise and elevated road, adding three banyans to pale old clearings: B1 right of the portico, B2 left of the midrise, and B3 near the road. [banyan_far_flat.png](banyan_far_flat.png) carries those same placements into simplified volumes. Use exposed plaza space behind a few supports so their pale vertical rhythm survives among the darker forest; avoid placing every banyan in a neat row or concealing every pillar behind mangroves.

### Harvest remains and variation

[banyan_stump.png](banyan_stump.png) shows **one main stump plus nine pillar stumps**, all rooted at B1's original locations. Cut the main stem at **0.50 m**, with short 5–10 cm torn fibres; cut pillars at **0.35–0.50 m**. Preserve each base's diameter, orientation and paving contact. Remove the whole crown, limbs and hanging roots when the main harvest target is exhausted, and shorten all pillar collision posts with the visual swap. No head-height posts, floating branches or old canopy shadow remain.

Cut surfaces are shallow uneven basins of overlapping stone-hatchet facets, interrupted rings, rough wedges and short torn fibres, never planar saw disks. The low stump set persists until regrowth restores the same individual and all its original pillar positions. Other banyans use their own pillar counts. B3's raised wreck belongs to its standing visual state and disappears with the removed upper structure; do not leave it floating above cut pillars. Restore the same attached wreck on regrowth.

For variants, retain each individual's pillar count and topology. Move a pillar by at most about 0.3 m while updating its joint and stump together; check route width and verticality afterwards. Vary crown-lobe size by roughly 15%, upper twig directions and curtain lengths freely within the ranges, but preserve B1's long roof, B2's three first pillars and B3's broken-west/full-east asymmetry. Rotate the complete asset freely. The mature B1 family may have 6–9 pillars in separately authored variants; this pictured B1 has nine.

## Material colours

All swatches below are **8-bit sRGB hex colours**, written `#RRGGBB`. They are intended material/base-colour targets, not samples from a sunlit pixel. Use the variations as restrained material variation; obtain directional highlights and occlusion from lighting. Do not bake the golden afternoon sun into every leaf.

| Part | Main colour | Secondary colours / intended use |
| --- | --- | --- |
| Fig bark | `#A6A79C` | `#C5C1AE` pale patches; `#6E7770` cooler aged patches; `#59634A` sparse damp film |
| Fig aerial roots | `#887C65` | `#B0A28A` dry raised surface; `#5C5E4D` older darker strands |
| Fig upper leaf | `#2E4C2C` | `#425D32` mature variation; `#647447` underside; `#9AA448` young growth |
| Fig cut wood | `#D9C392` | `#B69A68` older inner fibres; `#E7D5AE` freshly torn edges |
| Mangrove upper bark/roots | `#8A8371` | `#A99C83` pale dry patches; `#655F50` aged creases |
| Mangrove wet roots | `#4D5142` | `#343F38` wettest bases; sparse `#6D734C` algae |
| Mangrove upper leaf | `#244A33` | `#365D3B` mature variation; `#708454` underside; `#A4AF50` fresh growth and lighter midrib |
| Mangrove cut wood | `#D2AA7F` | `#E3C49A` fresh fibres; `#A87853` inner colour variation |
| Oak bark | `#493F34` | `#6D5A43` exposed ridges; `#2E322C` deepest fissures; `#81725A` small weathered edges |
| Oak upper leaf | `#344A35` | `#4C6241` mature variation; `#89917A` pale underside; `#89934B` new growth |
| Oak cut wood | `#DCC296` | `#AE855B` heartwood; `#EAD6B1` torn fibres |
| Spanish moss | `#929C87` | `#BBC0A5` silvery tips; `#677765` denser inner filaments |
| Fern | `#4F7435` | `#8DA647` young fronds; `#2F5031` mature shaded blades |
| Sparse dead leaves | `#94633A` | `#B68B51` dry yellow-brown edges; keep to roughly 1–3% of visible leaves |
| Swallowed concrete | `#A49E8C` | `#CCC0A2` old exposed faces; `#666A5D` damaged recesses |
| Rusted steel/sign | `#8C4F2E` | `#B5743F` flaking rust; `#454A43` surviving dark metal |

For the untextured distant treatment, use three flat greens per species: fig `#647D32 / #465F28 / #2C4525`; oak `#7F9967 / #5C7B55 / #365640`; mangrove `#375C3D / #244733 / #193A30`. These are lighting-and-colour study values for the flat painting, not replacements for the base-colour table. Retain pale fig stems, dark oak limbs and grey-brown mangrove arches.

## Leaf and hanging-material sheet

The five samples have separate display scales. The printed dimensions measure the complete twig span or hanging sample length; do not treat all five as one common-scale botanical board.

| Sample | Full displayed specimen | Individual elements |
| --- | --- | --- |
| Fig twig | 36 cm across | Mature blades 10–14 × 5–7 cm; alternate arrangement; leathery oval, smooth margin, short point; include one underside and one unfolding tip |
| Mangrove twig | 32 cm across | Blades 9–13 × 4–6 cm; opposite pairs, thick elliptic blades, pale midrib and subtly rolled margin |
| Live-oak twig | 24 cm across | Blades 3–5 × 1.2–2 cm; alternate, narrow oval, mostly entire slightly recurved margin; pale underside; no lobed temperate-oak outline |
| Spanish moss | 90 cm long | Fine branching curled filaments and minute narrow leaves; maintain substantial transparent space |
| Fig aerial-root tuft | 120 cm long | Five uneven tapering roots, generally 0.5–2 cm at their upper ends, with thinner side branches and free tips |

Use these as shape and material references when painting cut-out cards. The sheet is lit concept art on an opaque background, not a finished alpha atlas: author clean masks and unlit colour from it. Preserve curled leaf tips and modest underside variation without making every card conspicuously different. Use several rotated twig cards within each cluster; avoid one flat radial fan repeated throughout the crown.

## Harvest remains

Keep the standing tree and stump at the same origin, rotation and base scale. The root contacts and swallowed object must not jump when the crown disappears. Retain bark around the outer rim and expose pale rough wood only at the hacked surface. Individual axe facets are irregular wedges, with an off-centre knot of torn fibres, interrupted growth rings and uneven splinters; no clean flat saw disk.

| Remain | Target cut height | Required retained structure |
| --- | --- | --- |
| Fig | 0.8 m, variants 0.6–1.0 m | Fused basal root wall and embedded city remnant; wood is hacked around concrete or steel. The object may protrude 0.1–0.2 m above the wood, still inside the stump footprint. |
| Mangrove | 1.0 m for the pictured low-collared variant | Entire compact low cage, wet legs, open cavity and only a short hacked stem above its convergence. |
| Oak | 0.7 m, variants 0.5–0.9 m | Broad dark-barked base, pale rough basin of cut wood, a little darker heartwood and short torn central fibres. |

**Mangrove height constraint:** a cage whose upper roots join the trunk at 1.5–2 m cannot remain intact below a cut at 1 m. The stump painting therefore deliberately uses a low-collared individual. For the strict 1 m harvestable build, keep the highest root junction about 0.90–0.95 m and the cut at 1.0 m, approximately the low end of the requested root-shoulder range. Carry this same low collar into its standing model; never shrink or lower the cage only on harvesting. The taller shoulder shapes in the lineup guide root curvature and age variation, but need this height adjustment for that strict stump rule.

## Forest placement and distance

[hammock_near.png](hammock_near.png) uses a 1.7 m eye-height viewpoint, with a fig approximately 6 m ahead, a large oak behind and to the right, and a small mangrove group in the shallows. The ruined path provides scale and an unobstructed approach to the fig's stem. Place figs near narrow built remnants, oaks on the raised park soil, and mangroves where mud meets water. A few palms provide tall, thin accents; their approximate background height is 18–22 m.

The distant pair keeps three shared landmarks: the broken portico at left, the rectangular midrise right of centre, and the elevated road at right. Treat the midrise as roughly 20 m tall. Broadleaf trees should not become enormous towers above it. At about 400 m, the shoreline mangroves establish the low band, fig domes punctuate the hillside, and oak tiers spread through the intervening space. Mix ages in patches without putting one instance at regular intervals.

Distance in metres alone does not specify pixel size. For a 1920-pixel-wide view with a 90-degree horizontal field of view, a 16 m tree at 500 m projects to about 31 pixels in height (`960 × 16 / 500`); a 6 m mangrove projects to about 12. At 400 m those become about 38 and 14 pixels. The near/far paintings are art-direction studies, not measured engine screenshots.

When building the far model, preserve the top silhouette, two or three large negative spaces, and the relative values of crown and stem. Collapse detail inside these shapes. At very small sizes, root fibres, moss strands and single leaves should disappear gracefully. Keep the oak's horizontal dark structure and the fig's pale fork slightly more substantial than incidental branches so they survive reduction.

The flat painting demonstrates the intended simplification: rounded olive fig masses on pale posts; cooler, wider stepped oak masses on dark elbows; a dark mangrove shore; and sparse palms above. Its colours separate the species more strongly than the fully lit painting to make the construction decisions visible. In the game, silhouette must carry the same distinction under different sun directions and changing light.

## Review and provenance

Twenty-seven images were generated and visually inspected across both rounds. The original revisions corrected the distant view's initial giant figs, oversized fig trunks and leaves, open oak crowns, broad mangrove root footprints, insufficiently distinct flat silhouettes, the leaf sheet's root ends, and the oak stump's overly planar cut. Banyan revisions widened B2, corrected relative heights and the scale figure, and lowered B1's harvested main stump and central splinters. The per-image decisions are recorded in [source/REVIEW.md](source/REVIEW.md).

All imagery originated from words. Only paintings generated in this task were supplied as edit inputs. No other game's pictures, photographs or web image references were used. No git commands were run. Working files and archived outputs are confined to this folder; the image tool also retains its automatically managed original outputs.
