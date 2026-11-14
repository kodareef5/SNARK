# Wood tier — a house built with care

The design is a dark hewn frame holding warm, thick, individually fitted boards. Its identifying features are short pegged knee braces, two unequal sets of weatherboard courses within each solid wall, shouldered timber feet and heads, and small pieces of forged iron at working joints. The wood is seasoned and handled, not rotten. Sunlight warms the paintings; the material colours below are the unlit targets.

## Reading this package

The fourteen painted PNGs establish appearance, material, joinery and lighting. `dimensions.png` is the exact orthographic envelope/opening guide. Dimensions in this document and that guide control the scripted model: do not measure millimetres from perspective paintings. In particular, the generated doorway studies retain some proportional drift, and closeups exaggerate small hardware and relief for legibility. Build the 1400 × 2310 doorway, 200 mm wall and 80 mm door specified here.

All numbers below are **millimetres**, unless marked metres. Width is X, depth/run is Y, height is Z. Walls run along X with their centre plane at Y=0. Shape variation is cut inward from the collision envelope. Snap faces, walking surfaces, openings and hinge axes remain accurate.

| Piece | Exact envelope | Painted reference |
|---|---|---|
| Foundation | 3000 × 3000 × 375 | `piece_foundation.png` |
| Wall | 3000 wide × 3000 high × 200 deep | `piece_wall.png` |
| Doorframe | Wall envelope; clear opening X=800–2200, Z=0–2310 | `piece_doorframe.png` |
| Windowframe | Wall envelope; clear opening X=900–2100, Z=1200–1900 | `piece_windowframe.png` |
| Door | 1400 wide × 2310 high × 80 deep | `piece_door_shut.png`, `piece_door_open.png` |
| Ceiling | 3000 × 3000 × 250 | `piece_ceiling_above.png`, `piece_ceiling_below.png` |
| Pillar | 500 × 500 × 3000 | `piece_pillar.png` |
| Stairs | 3000 wide × 3000 run × 3000 rise; ten steps | `piece_stairs.png` |

Both wall faces use the same finished construction and palette. There is no unfinished indoor face; the wall may be reversed. The single wall painting specifies both faces. The ceiling underside is shown tipped toward the viewer for inspection, not installed vertically. The open-door study includes a hinge jamb only to explain its pose; that jamb belongs to the doorframe.

## Material palette

These are **8-bit sRGB base-colour values**, not linear RGB and not sampled sunlit colours. Use gentle variation within one timber species; do not alternate pale and dark boards.

| ID | Use | Hex | sRGB R, G, B |
|---|---|---|---|
| B | Main sawn boards | `#AC8052` | 172, 128, 82 |
| B− | Quiet darker board variation | `#A0754B` | 160, 117, 75 |
| B+ | Quiet lighter board variation | `#B88D60` | 184, 141, 96 |
| T | Hewn structural timber | `#62432D` | 98, 67, 45 |
| T+ | Rubbed timber arrises | `#765237` | 118, 82, 55 |
| D | Worn horizontal deck/roof boards | `#A78A65` | 167, 138, 101 |
| E | Exposed end grain | `#BA956B` | 186, 149, 107 |
| P | Hardwood pegs | `#B18E60` | 177, 142, 96 |
| I | Forged iron | `#302D29` | 48, 45, 41 |
| I+ | Small polished iron edges | `#5A554B` | 90, 85, 75 |

Wood is nonmetallic, with roughness roughly 0.65–0.85; touch-worn areas may reach 0.5. Iron is dark, mostly rough forged metal, with tiny rubbed edges. Keep rust to restrained seams and pin shoulders, not orange blotches. Grain follows the actual member; crossgrain belongs on exposed ends. Dark lap shadows, contact shadows and sunny highlights belong to lighting, not painted black/white stripes in base colour.

## Foundation

The foundation is a deep timber sill frame with a nailed plank deck. It should look heavier than a ceiling even when both are seen only at their edge.

| Part | Intended dimensions and construction |
|---|---|
| Perimeter sills | 180 wide × 330 high, contained in the 3000 square; deck adds 45 above |
| Corners | Shouldered half-laps, 180 long, 165 deep into each meeting sill; end grain visible on alternating faces |
| Central spine | 180 × 330, runs along Y at X=1500; bears on a pillar placed beneath the tile centre |
| Floor joists | 90 × 200, at Y=600, 1200, 1800, 2400; housed into perimeter and spine, forming two short spans |
| Deck | 45 thick, widths 170–290, long direction Y; 3–4 joints, maximum 2 mm local height variation away from tile boundaries |
| Board ends | Normally full tile length; at most three staggered butt joints, each directly over a joist |
| Corner iron | Two short dogs per visible corner face, 160–220 long × 40 wide × 5 thick; 12 mm shanks, 20–24 square heads |
| Deck nails | 5 mm square shanks; 9–11 heads, paired over supporting members |

The top is one continuous walking plane at Z=375. The apparent edge strip in the painting is a flush deck edge board over the rim, not a raised picture frame. No overhang, external legs or border lip. Recess iron into the sill sufficiently to keep its outermost point inside the 3000 square.

Colours: deck D with restrained B/E wear; sills and spine T/T+; pegs P; iron I/I+.

Hand-built shape: 6–12 mm irregular sill chamfers; shallow 1–3 mm adze facets; slightly unequal deck widths; one or two 30–80 mm end checks; 1–2 mm nail-setting differences; gently rounded high-traffic deck edges. Keep the bearing faces and tile seam level.

## Wall

One reusable square panel, with a central post dividing the weatherboards into two fields. Use the final `piece_wall.png`, where the left and right course heights differ. This variation is part of the piece, not random deformation applied after placement.

| Part | Intended dimensions and construction |
|---|---|
| Frame depth | 180, centred within the 200 total envelope |
| Edge stiles | 90 wide × 180 deep, at X=0–90 and 2910–3000; paired straight neighbours read as a 180-wide post |
| Centre upright | 140 wide × 180 deep, X=1430–1570 |
| Top plate | 190 high × 180 deep, Z=2810–3000; pegged to uprights |
| Bottom rail | 180 high × 180 deep, Z=0–180 |
| Knee braces | 65 face width × 45 deep; about 380 horizontal/vertical reach; shouldered into post and plate |
| Boards, each face | Tapered weatherboards, 28 at the butt and 8 at the feather edge; 35 vertical lap |
| Visible board heights | 150–310, deliberately mixed; sum to the infill height, with different sequences in the two fields |
| Shadow joints | 2–4 visible dark reveal; backed by the lap, never a through-hole |
| Concealed battens | 50 × 50 behind each skin where butt seams occur; every shortened board has backing |
| Timber pegs | 18 diameter, mildly faceted, ends projecting 3–6 beyond the timber face |
| Small foot-joint straps | 120–160 × 30 × 4; two 10–12 square heads; only at post-to-rail joints |

The two board skins occupy approximately Y=50–86 and Y=−86 to −50, including their laps. Knee braces and frame faces stay within Y=±90. Pegs, iron and heads must remain within ±100. The void between the skins holds nail battens; do not make the panel a textured solid box.

Each face has the same structural arrangement. Give the reverse equal finish quality and the same course layout; the grain need not be a mirrored decal. Board ends tuck 12–18 behind the frame's rebates. Keep only three inconspicuous supported butt joints across the whole visible wall; avoid a repeated zigzag motif.

Colours: boards B with B−/B+ differences; frame T; exposed facets T+; pegs P; occasional iron I. The frame should supply most of the value contrast.

Hand-built shape: actual tapered board cross sections, slightly wandering lap edges, different board heights, 2–4 mm inward bow, 6–10 mm varying timber chamfers, slightly canted brace faces, small end checks near selected nails. No severe damage, giant signature knot or projecting broken plank to repeat across an entire base.

## Doorframe

Use the wall's depth, edge stiles, top plate, boards, pegs and colour treatment. Replace the central post with a framed opening. **The opening is 1400 wide and 2310 high, centred, beginning at the floor.** Side piers total 800 each, including the jambs. No bottom rail crosses the opening.

| Part | Intended dimensions |
|---|---|
| Left jamb | 180 face width × 180 depth; X=620–800 |
| Right jamb | 180 face width × 180 depth; X=2200–2380 |
| Lintel | 210 high × 180 deep; underside Z=2310, top Z=2520; shoulder ends onto jambs |
| Upper infill | Z=2520–2810, using two fitted courses where practical |
| Jamb pegs | Two 18 mm pegs per lintel shoulder, staggered slightly, not mechanically aligned |
| Hinge receivers | Left jamb, nominal centres Z=320 and 1990; forged 50 × 140 × 6 plates, 12 mm pintles |
| Strike | Right jamb near Z=1050; approximately 45 × 120 × 5, recessed |

Bottom rails continue only beneath the two side infill fields. Fit the wall's short knee braces into the outer upper corners; keep them outside the clear opening. Rebate stops into the jambs instead of adding thick applied trim.

Colours: infill B; jambs, lintel and outer frame T/T+; pegs P; hinge receivers and strike I. Hand-built shape: slight jamb arris variation, individually cut lintel shoulders, an adzed underside outside the clear aperture, different side-pier board heights, handled wear by the strike. Never bow timber into the doorway.

## Windowframe

The open hole occupies X=900–2100 and Z=1200–1900. It is 1200 × 700, without glass, shutters, crossbars or a permanent covering.

| Part | Intended dimensions |
|---|---|
| Jambs | 160 wide × 180 deep, immediately outside the hole: X=740–900 and 2100–2260 |
| Sill | 1520 long × 170 high × 200 maximum depth; top datum Z=1200 |
| Lintel | 1520 long × 170 high × 180 deep; underside Z=1900 |
| Centre upright | 140 × 180, below the sill and above the lintel only |
| Sill drainage | Two shallow faceward slopes, no more than 3 mm drop; 4 × 4 underside drip kerf near each face |
| Pegs | 18 diameter through the jamb/sill and jamb/lintel shoulders |

The sill is finished on both faces. Its faces stop at Y=±100, only 10 beyond the main timber frame. It must not become a shelf outside the wall envelope. Keep the minimum clear opening dimensions intact; the shallow drainage cuts remove material away from that aperture.

Colours: infill B, frame T, rubbed sill T+/E, pegs P. Hand-built shape: broad chamfer under the sill, little adze scallops on jamb edges, end grain at shoulders, slight wear where hands rest, irregular board widths around the hole. Avoid streaking every board below the sill the same way.

## Door, shut and open

This is a ledged-and-braced plank leaf. The hinge is on the **left when seen from outside**, and the leaf opens **outward**. The homestead pose is about 65°. In the separate reverse-side painting the hinge therefore appears on the viewer's right.

| Part | Intended dimensions and construction |
|---|---|
| Nominal leaf/collision | 1400 × 2310 × 80 |
| Fitting clearance | Rendered wood can stop 4 short of either jamb and 3 short at top/bottom within that nominal envelope |
| Vertical boards | 35 thick, six or seven unequal widths roughly 170–260; rebated 12 mm edge joints, 2 mm visible seams |
| Rear ledges | Two, 180 high × 35 thick, stopping 25 short of each side; centres align with the hinge straps |
| Rear compression brace | 110 wide × 35 thick, housed between ledges; from lower hinge to upper latch corner |
| Strap hinges | Two, about 800 long × 50 tapering to 30 wide × 6 thick; 26 outer-diameter knuckle on 12 pintle |
| Hinge fastenings | Three working fastenings per strap through into the rear ledge; 10–12 square heads |
| Pull | 170 high × about 35 wide; flattened 12 × 7 section, compact bow in a recessed finger pocket |
| Thumb latch | 110 long lever/bar, 6 thick, on a recessed 45 × 110 plate at about Z=1050 |

Keep the 80 mm depth: in a local depth coordinate 0–80, put the 35 mm board slab at 10–45 and rear ledges at 45–80. Exterior straps occupy 4–10. Recess the exterior finger pocket about 20–25 into the plank so the pull can be grasped while its outermost point stays at 0. The rear pull/latch can occupy the free space between the board back at 45 and the rear envelope at 80. Do not copy an exaggerated stand-off from the closeup and make a thicker door. Keep metal away from the latch-edge clearance and put the mating pintle support on the frame.

In the reverse view the brace runs lower right to upper left. Its ends bear against the ledges; it is not a diagonal nailed loosely onto their faces. Clench fastenings on the back. Stop all ledges within the door outline.

Colours: board field B, ledges and brace T/T+ with worn B edges, iron I/I+, finger wear B+/E. Hand-built shape: unequal board widths, slight inward edge wander, shallow split at one board end, hand-set square heads, hammered strap edges, low irregular chamfers and a polished thumb area. Keep the hinge axis straight and the leaf sufficiently flat to swing.

## Ceiling / upper floor / flat roof

One tile serves all three uses. The top has no roof-specific object on it. It is a flat, walkable board floor, and the underside is open joist construction.

| Part | Intended dimensions and construction |
|---|---|
| Deck boards | 40 thick, 170–290 wide, 3 mm rebated joints; long direction Y |
| Perimeter rim | 90 wide × 210 deep, all within the 3000 square |
| Internal joists | Four, 90 × 210, running X at Y=600, 1200, 1800, 2400 |
| Joist ends | 30–40 housed shoulders in rim; 18 mm pegs through the working joint |
| Butt joints | Two or three, staggered and supported directly over a joist |
| Edge treatment | 4–6 mm inward chamfer; no overhang or protruding joist tails |

The final underside painting has **four internal joists**, plus the two parallel perimeter members; use that arrangement. Early prompts asked for five, which is superseded by this selected design. No lower cover board hides the joists. Narrow housed ends and pegs should explain how the rim holds them.

Installed against a 3000-high wall, the ceiling top is Z=3000, board underside Z=2960 and joist underside Z=2750. The upper wall/ceiling intersection is a **shared housed joint zone**, not a ceiling stacked on top of the wall. Provide 60–90 mm bearing seats at wall uprights, with shoulders at Z=2750 and mating end housings within the upper 250 of the wall frame. Keep all sockets permanent and within the panel, so the same wall accepts a ceiling on either face. The cutaway in detail 06 shows the intended seated load path. Concealed timber interpenetration is a modular assembly convention; do not display two overlapping fascias or double the roof thickness. Relieve hidden contact faces by 1–2 mm where needed to prevent coplanar surface flicker.

Use rebated board edges and darkened pitch/oil in the seams to suggest a serviceable exposed flat roof. The visible top datum stays flat; do not add a slope, membrane, battens, gravel or shingles. No gutter extends beyond the tile.

Colours: top D with B/E wear; board underside B; joists T/T+; pegs P; small nail heads I. Hand-built shape: slightly unequal widths, restrained cup within 2 mm between supports, saw-cut ends, shallow hewn joist facets, individual housing shoulders and modest corner wear. Joint lines between tiles should be no stronger than an ordinary board seam.

## Pillar

A 500-square piece of timber is carved down to a 380-square shaft, retaining its head and foot. It carries a ceiling on a porch or supports the middle of a foundation. The head and foot are integral timber, not applied decorative collars.

| Part | Intended dimensions |
|---|---|
| Maximum envelope | 500 square × 3000 high, including all hardware |
| Foot | 500 square from Z=0–240, bevelled shoulder reducing to shaft by Z=300 |
| Shaft | 380 square; 18–30 mm variable corner chamfers, making a softened octagonal section |
| Head | Expands from shaft at Z=2620 to maximum 500 by Z=2750; shaped seats above |
| Ceiling bearing | Shoulders at Z=2750; upper 250 nests within slab's joint zone, top at Z=3000 |
| Head housing | 90 wide for ceiling rim, 250 high, with central timber retained; keep useful bearing across both rim directions |
| Cheek iron | Short 160–200 × 50 × 6 straps recessed into head; two 12 mm pins each |
| Pegs | 22 diameter, 6 mm proud maximum, also within the 500 envelope |

For a foundation above, the retained flat central crown bears beneath its central spine. For a ceiling, the shoulder and housings carry the rim at Z=2750. Neither use gets a larger capital. The foot bears directly on timber or terrain; there is no added stone base.

Colours: shaft/head/foot T with substantial T+ facets, E on ends, P pegs, I iron. Hand-built shape: long, broad adze facets rather than bark, small deviations of the chamfer width, one restrained longitudinal check, faceted shoulders and visible crown end grain. Keep the post axis and bearing faces plumb and level.

## Stairs

An enclosed timber stair block, wide enough to feel like a substantial building piece. Its underside is closed, not an open ladder. The internal cavity need not be filled with solid timber.

For step index i=0…9, the tread occupies Y=300i…300(i+1), with its top at Z=300(i+1). Each rise and going is exactly 300. The tenth tread is the top of the piece, with nothing above it.

| Part | Intended dimensions and construction |
|---|---|
| Treads | 50 thick; each made from two boards across the full width, example depths 170 + 3 seam + 127 = 300 |
| Risers | 32 thick, fully closed; visible height 250 below the next 50 mm tread |
| Tread nose | 6 mm upper-edge chamfer; riser may sit 10 behind the nose, entirely within the run |
| Internal strings | Three, approximately 120 × 240, housed for bearers, near both sides and centre |
| Tread bearers | 90 × 120, housed at each step, supporting the 3000-wide treads at three positions |
| Ground sills/rear frame | 150 × 150; all contained within footprint |
| Side and rear boards | 35 thick, 180–270 wide; vertical grain on the triangular sides, close-fit 3 mm backed joints |
| Bottom closure | 25 thick boards inside the envelope |
| Fastening | 6 mm square nails, 10–12 heads at bearers; occasional recessed 40 × 5 iron dog at a real frame joint |

No rail, wall or raised header at the top. No diagonal exterior beam crosses the walking surfaces. The side's diagonal string is recessed flush with the cladding. Put tread-board butt joints directly over the central support, not randomly along the width. The total width includes side boards and iron.

Colours: treads D/B, risers and side boards B, structural frame T/T+, restrained nails I. Hand-built shape: broader handworn highlights in the middle of treads, gently irregular board edges below the level walking plane, varying side-board widths, sawn stepped board tops and small hammered nails. Keep equal risers; handmade does not mean unsafe random step heights.

## How copies meet

Straight walls pair their 90-wide edge stiles into one 180-wide vertical rhythm. At an outside corner the same stiles form an L-shaped meeting, with narrow chamfered reveals explaining the two pieces. Detail 01 expresses that paired construction. Do not add an oversized corner post, extend the wall beyond its 3000 width, or replace it with a special corner mesh. Keep overlapping hidden joint volumes free of visible duplicate faces.

Walls are centred on foundation edge lines: their 200 depth straddles the line by 100 on each side. The inner portion bears over the rim. The exposed deck can therefore differ between an exterior edge and an adjoining foundation; do not move the wall inward to make the floor trim look tidy.

Foundation and ceiling boards end at their own tile boundaries. Their 3–4 mm joints and inward chamfers give a modest seam when repeated. No metal strap bridges independently placed pieces, and no beam end projects into the next tile. Broad structural silhouettes stay exact; irregularity belongs inside them.

A row of six identical walls should produce posts and quiet, varied infill, not six identical obvious scars. A floor of twenty tiles should read as a floor, not twenty framed trays. Use restrained variation in grain and value; the design must work with exact copies, without relying on random per-instance colouring to hide repetition.

## Locked homestead layout

Use metres for these placements. Ground datum is world Z=0; the foundation deck is Z=0.375. Front is negative Y.

| Element | Location |
|---|---|
| Four house foundations | X=0…6, Y=0…6, arranged 2 × 2 |
| Two porch foundations | X=0…6, Y=−3…0 |
| Front doorframe | Along Y=0, X=0…3; opening X=0.8…2.2 |
| Front windowframe | Along Y=0, X=3…6 |
| Second windowframe | Right wall X=6, rear bay Y=3…6 |
| Remaining perimeter | Five solid wall panels: two left, two rear, one right front |
| Six ceiling tiles | X=0…6, Y=−3…6; roof top world Z=3.375 |
| Two porch pillars | Centres (1.5, −2.75) and (4.5, −2.75), bases at deck level |
| Side stair | X=6…9, Y=0…3; rises toward +Y; top world Z=3.375 |

The stairs begin at **deck elevation**, on a low earthen bank beside the house. This reconciles their exact 3 m rise with a floor already 0.375 m above the surrounding field; it adds no seventh foundation. Do not start these stairs at world ground and stretch them to reach the roof.

`homestead_front.png` is the close player-height view; `homestead_field.png` is the approximate 60 m view; `homestead_above.png` shows the roof and porch from above. They share the same door/window layout, six-tile roof, two pillars and right-side stair. The rear right window can be obscured in the low front view. The sketches are perspective paintings, not calibrated survey views.

## Detail sheet index

| Panel in `details.png` | Build decision |
|---|---|
| 01 — Wall corner | Two chamfered edge stiles meeting, visible peg construction |
| 02 — Wall bearing | Wall foot over deck and deep foundation sill |
| 03 — Hinge and pull | Forged working hardware, restrained square heads, handled wood |
| 04 — Window sill | Pegged shoulder, inset sill, drip kerf and open aperture |
| 05 — Foundation lap | Half-lapped deep sills, end grain and short corner dogs |
| 06 — Joist seat | Housed bearing, roof top flush with wall top |
| 07 — Pillar head | Retained shoulder and rim seat within 500 square |
| 08 — Pillar foot | Integral hewn block, direct deck contact |

## Source and review record

All paintings were generated with the built-in image tool from written direction and our own images. No other game's images were searched for, copied or supplied. The existing `now/` renders were read as the user's starting point; no outside visual reference was used.

`source/prompts/` holds every generation/edit prompt. `source/generations/` holds every generated variant at its native resolution, including rejected versions. `source/guides/` contains original geometric blocking guides; their generator is `source/make_guides.py`. `source/make_dimensions.py` creates the exact envelope sheet. `source/manifest.json` identifies the selected images and their hashes; `source/gallery.html` opens the selected art together. This document is also copied to `source/DESIGN.md`.

The main revisions removed the first house's thick roof and narrow stair, broke the wall courses across the centre post, corrected doorframe proportions, and removed a spurious stair-top rail. The selected art deliberately keeps rich tool-work while limiting damage. A final dimensional pass must use the exact guide for the doorway and the written joint/thickness rules rather than copying painterly exaggeration.
