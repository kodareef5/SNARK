# Miami interiors · window texture report

All eight room folders contain four 512 × 512 base-colour PNGs and a manifest giving width, height and depth in metres. I checked the PNG headers and decoded every map as 8-bit RGB with an sRGB tag. The comparison sheet shows all sixteen views at both requested reductions. [Distance sheet](checks/far.png)

I used the built-in image generator for original front elevations, material surfaces and isolated furniture parts. I assembled the four faces in Pillow and NumPy at 180 pixels per metre, adjusted their pigments together, registered trim and floor contacts, and resized each completed face to a square. The unfolded checks restore a common scale of 100 pixels per metre. They show the same side texture reflected across the two returns.

The left image in each window check uses the centred eye. The right image moves the eye 3 m left, with both positions 3 m outside and 1.7 m above the floor. Both cameras stay level, with the 1.4 × 2 m opening centred in the frame. The renderer samples the first interior face along each ray through the aperture. The surrounding grey wall makes the sill crop visible. Glass reflections and depth lighting belong to the game. Run `python3 render_checks.py` to regenerate all 17 check images from the delivered maps. [Check renderer](render_checks.py)

## Room 06 · Open-plan office

I set the smoked-glass frontage against two low fabric workstations and carried the cabinet feet into the carpet edge. I built the ceiling over a continuous duct layer, with 56 open bays in a 13 × 13 grid and three double-width, unlit louvred fixtures. The straight view shows a chair pulled from its desk. From the left, the open ceiling and the low wall raceway establish the depth. At quarter size the opaque lower glass panels still separate the meeting enclosure from the desks, although the glass itself looks almost solid. [Cross](checks/cross-room-06.png) · [Window views](checks/view-room-06.png)

## Room 07 · Meeting room

I paired the water-damaged veneer and rubbed whiteboard with an overhead tabletop and eight chairs, including two overturned chairs with exposed caster bases. The first window test showed only the end of the table. I turned the group across the room, left clearance behind the chairs and kept the wood joint visible near the sill. The dead linear fitting leads the eye to the board. At this low viewing angle the chair seats flatten considerably, and the tipped bases read best in the cross. [Cross](checks/cross-room-07.png) · [Window views](checks/view-room-07.png)

## Room 08 · Gutted office

I registered the concrete piers to short floor footings, brought out the exposed channel edges and fitted the overhead zinc trunk to collars at the same depth on both side walls. The angled view shows the trunk entering the concrete. Straight on, the torn board, diagonal brace and dangling cable break up the vertical studs. The trowel ridges in the old adhesive survive close inspection, but the distant floor reads as patched concrete. [Cross](checks/cross-room-08.png) · [Window views](checks/view-room-08.png)

## Room 09 · Archive

I anchored the steel uprights to five footplates and gathered the softened cartons into a few shelf bays. On the grey vinyl I lifted the value of two pulp deposits and layered translucent torn page corners into them. The shelf openings remain distinct at quarter size. The lateral view picks up the flood line, skirting and stained ceiling. Its plain side wall gives little indication of what was stored here once the shelves slip out of sight. [Cross](checks/cross-room-09.png) · [Window views](checks/view-room-09.png)

## Room 10 · Empty shop shelves

I narrowed the run of gondolas and repositioned the stockroom door after its handle fell outside the first straight-on crop. The threshold continues into the pale tile floor. One dead twin-tube strip now falls beside the duct in that same view, above the shelf run and closed door. The bent shelves remain recognisable at quarter size. The two toppled tins become small flecks at that distance. [Cross](checks/cross-room-10.png) · [Window views](checks/view-room-10.png)

## Room 11 · Corner cafeteria

I wrapped the seafoam tile around the counter ends, placed six stool positions a metre in front of the counter and fitted worn footrings around the intact seats. One seat leans on a bent post and one bare mounting remains. The blank board, serving hatch and stopped five-blade fan give the straight view three distinct silhouettes. At the side angle the wainscot carries the room around the corner. The stool tops compress to narrow ovals through the window, so the difference between a broken post and a missing seat is chiefly visible from above. [Cross](checks/cross-room-11.png) · [Window views](checks/view-room-11.png)

## Room 12 · Cleared shop

I placed the broken fibre panels beneath a matching breach in the ceiling grid. Two jagged tile remnants and a loose cross tee survive at the opening. I moved the drain into the floor strip visible through the window and aligned the shutter foot with its threshold. The shutter, pile and drain are all visible together from the front. The pale outlines of removed fittings are deliberately low contrast and largely disappear at one-sixteenth scale. [Cross](checks/cross-room-12.png) · [Window views](checks/view-room-12.png)

## Room 15 · Burnt room

I matched the soot band across the rear corners, aligned the 2.16 m iron bed elevation with its 0.91 m deep spring frame and worked pale ash into the floor below the surviving rails. The rear view retains the high headboard and sagging side rail. The oblique view picks up the exposed ceiling channels and the drop from black soot to grey plaster. Very little floor clears a 1 m sill in this shallow room, so the ash and fine wires are easiest to judge in the cross. The 2.9 m ceiling meets the façade 10 cm below the nominal window head. I rendered that upper strip as solid wall. [Cross](checks/cross-room-15.png) · [Window views](checks/view-room-15.png)

<details>
<summary>Source-layer generation prompts</summary>

The wall and surface requests used a shared opening followed by the individual layer description. The furniture inserts used the individual requests below. Registration, placement and colour grading took place after generation.

### Rear elevations

**Shared opening**

Stylized-concept, finely observed realistic videogame environment texture. A single seamless-at-edges BACK WALL elevation, absolutely front-on orthographic diffuse/albedo material scan for a weather-beaten Miami interior decades after abandonment. Edge-to-edge elevation ONLY. Image top is wall/ceiling seam, image bottom is the exact line along the floor at the foot of the wall. Exclude the floor, the ceiling, return walls and any room perspective. All verticals parallel; all major horizontals perfectly level. No windows onto daylight. Extra-wide 2.36:1 composition unless a different ratio is supplied. Flat diffuse basecolor under completely directionless illumination; NO cast shadows, no directional light, no vignette, no bright reflections, no glow, no cinematic lighting. Favor distinctive large sparse shapes and materially specific wear (salt tide lines, crazed laminate, oxidized seams, small islands of peeled paint against intact areas), broadly quiet elsewhere, muted paint pigments from a humid coastal building. No signage or markings, writing, typography, graphics, posters, monitors, logos, living things. Leave a little exposed wall surface at the left and right ends, quiet corners. Entire elevation rendered as one rectified photographic texture.

**Room 06**

Wall is 8m wide x 3.4m tall. Cool grey-green painted gypsum. The left 40% glazed conference-room frontage in a dull anodized frame, split in three broad dark smoky aqua dusty glass panes with opaque grey kick panels. Glass reveals only a dim blank partition. On center-right a run of abandoned 1980s low fabric cubicle partitions and two recognizable horizontal desk tops with pedestals and paperless work surfaces, two askew pushed-back dark rolling office chairs, no electronics. Partitions are low, 1.35 m high, desks .75 m. Top half of composition almost all empty water-damaged warm grey plaster. Dark rubber cove base at floor. Keep feet inside image at very bottom. Tasteful restraint in wear. Smoked glass and fabric partitions visually distinct.

**Room 07**

Wall is 8m wide and 3.4m tall. Mostly desaturated putty-grey painted wall with a horizontally oriented large ivory-grey whiteboard centered on it, rubbed and uneven with faint cloudy erased dry smears, absolutely blank no writing or lines anywhere; thin anodized frame, small empty tray. Leftmost 30% is a floor-to-ceiling bank of several vertical plain water-stained walnut veneer panels in deep desaturated tobacco brown, some damaged at their lower edge, a single missing chip exposing the backing. Small regular dark grey cove base. NO table or chairs anywhere in this WALL texture; no room perspective. Unfurnished. A distinct height of blank plaster above and below the board.

**Room 08**

8m wide x 3.4m high stripped concrete wall of a gutted office, rectangular board-form impressions, patched plugs, a few localized stains from leaks. Two broad poured concrete structural columns, flat front faces, one at 20% and one at 75% width, spall at feet exposes aggregate. An interrupted run of thin galvanized-steel C-channel partition studs in front of the bare wall spans the middle ground, some bent or missing; variation in spacing, a single short diagonal bent brace and torn remnant of plasterboard at left, distinct empty bays. Two dead black electric cables loosely hanging near the top at 62% width. No brick, furniture, machinery, graffiti, deep holes or busy rubble. Very clearly frontal flat elevation. No floor visible. Restrained grey with occasional desaturated oxidized metal.

**Room 09**

8m wide x 3.4m high. Abandoned records archive in humid grey-olive limewash. A single bank of tall, battered freestanding industrial steel shelves spans from 0.65m to 7.35m across the width, rises to 2.7m. Four bays in all, four shelf levels; several empty bays. Dull desaturated blue-black angle-iron uprights with punched holes, folded steel shelf edges, occasional shelf sag. Fewer than 16 very plain kraft archive cartons spread in uneven groups, several slumped or collapsed with open flaps, softened and tide-stained by flood water. Plain brown cardboard with NO labels, writing, files, printed scraps or graphics, different silhouettes and some visible fluting. Negative space above and beside steel unit. Dark rubber cove base. This is a tall shelf elevation, cropped right at floor contact. Few large shapes.

**Room 10**

7.2m wide x 3m high. Abandoned street shop. Group of three joined, slightly buckled gondola merchandising shelf bays with perforated steel backs runs from 0.5m to 4.9m along rear wall, 1.85m tall; solid plinth/kick at ground, worn blue-grey powder-coat paint, three cantilever shelf lips each; almost entirely empty aside from two small unmarked dented tins on their sides. On the right at 80% width a CLOSED back-of-house doorway, dull grey-green institutional steel door, tarnished lever, no panel or signage. Old warm grey-green commercial paint with a few broad stains, charcoal vinyl skirting. The shelf profiles are frontal and parallel, no visible floor, no perspective. No checkouts, products, posters or graphics.

**Room 11**

7.2m wide x 3m high. Abandoned Miami lunch counter in a faded 1960s corner cafeteria. A single long low 1m-high flat-front counter from 10% to 90% width against the wall fills bottom band of the picture, bottom edge sits exactly at image bottom. The front face has large faded desaturated dusty seafoam laminate panels with a thin battered stainless rib, dark toe kick, continuous stainless counter edge and a chipped corner. Behind it, a dark rectangular serving hatch spans 30%-66% of width, with plain stainless surround and chipped pass-through ledge, dark quiet scullery inside. Small BLANK horizontal charcoal enamel menu board with narrow frame ABOVE the hatch, completely blank, absolutely NO words, symbols or strokes. Wall is old pale grey-cream, selective damp and peeled paint concentrated near one seam, remaining areas calm. NO stools on this elevation, no items on the countertop, no people. No modern restaurant decor.

**Room 12**

7.2m wide x 3m high, completely stripped shop wall. A wide closed galvanized metal roller shutter occupies the middle 43% of wall, from the ground exactly at image bottom up to 2.45m with shallow corrugated horizontal slats, heavy metal side rails, battered oxided bottom rail. Old faded warm mushroom-grey paint to either side. To the left and right of shutter, large clear rectangular ghost marks of removed fixtures, a few paired holes where shelf brackets once attached, a single tide mark. Thin dark cement plinth. Restrained wear around fixing positions and shutter foot, chalky concrete. No shelves, no door openings, no signs. No floor or framework crossing the outer edges.

**Room 15**

OVERRIDE aspect ratio: 4m wide x 2.9m tall, image aspect 1.38:1. Entire one wall and only this wall of a fire-damaged bedroom. The top third of the wall is heavily charred near-black carbon with rolling irregular smoke staining and soot fingers extending downwards, broad smoke-grey lower walls and irregular islands of spalled plaster revealing brown-grey base render. At the very foot of the wall, a single 2m-long ruined iron bedstead shown exactly SIDE ON in elevation, running horizontally against the wall slightly left of center, scorched plain tubular metal headboard at left and lower footboard at right, a few vertical bars, sagging empty rusted spring frame, no mattress, no bedding, no ornament. Top rail of raised headboard is about 1m above floor (lower third of image), narrow side rail .4m above floor. All four metal feet meet image bottom. Flat and desaturated burnt grey, deep black and muted iron oxide. No bed in perspective, no floor, no light or smoke in air.


### Side elevations

**Shared opening**

Stylized-concept photoreal videogame PBR base color. Precisely orthographic flat rectified elevation of one long EMPTY side wall in an abandoned post-hurricane Miami building. The whole width of this single wall exactly fills the image. Ceiling seam = topmost image edge. Floor contact = bottommost image edge. Absolutely no floor surface, ceiling, window, facing walls or returns visible. No vignette, daylight falloff, lit highlights, cast shadows, corner darkening, glows or dramatic lighting. Even diffuse material pigment. No people, furniture, large fixtures, cabinets, lettering, posters, brand, signs or anything readable. Leave broad areas intact or lightly worn, and only one or two areas of more severe damage, so the texture still reads from outside a window. Subtle chips, convincing decades of salt and damp, fine realistic material reconstruction. Both vertical ends plain so it can wrap to a neighboring wall.

**Room 06**

8.0m long and 3.4m high, 2.35:1 image. Muted mid-value grey-sage painted gypsum with damp pale green-grey discoloration low down, stormwater damage, a thin dark charcoal rubber cove base about 10cm at bottom, and an old narrow horizontal steel raceway at 43cm high along part of wall, capped before the last metre. One small dull duplex outlet plate. No wood, divisions or doors. Modest worn institutional office wall.

**Room 07**

8m long x 3.4m high, 2.35:1. Mostly calm warm greige painted plaster, thin 10cm high charcoal-grey office skirting at floor, a narrow dark brown scuffed wooden chair rail 0.78m above ground, with a missing section of rail at the very far right end. A faint dark scuff from a chair and a strip of loose paint along moulding. No board, wood panels, doors or furniture, no extensive mottling.

**Room 08**

8m long x 3.4m high, 2.35:1 ratio. Stripped midgrey cast-concrete wall. Tall and shallow repeated rectangular plywood form marks with paired tie holes, a vertical construction joint, two rust bleed marks, an outline in pale mineral dust of a partition removed, sealed dark electrical box below waist height. Bare concrete right down to bottom, no skirting. No stud wall, hanging cables or furniture.

**Room 09**

8m wide x 3.4m high, 2.35:1. Plain quiet faded grey olive archive wall, broad softly edged flood tide mark along part of lower wall, torn dull plaster at a patch near floor, very thin plain nearly charcoal vinyl skirting along floor. Old semi-matte mineral paint. NO shelving, furniture, cardboard, paneling or doors.

**Room 10**

6m wide x 3m high, 2:1 ratio. Muted desaturated warm grey-green wall behind an old shop aisle. Pale broad rectangular traces of a removed shop fitting, two old plugs in wall, broad blank quiet painted upper area. Thin charcoal vinyl skirting (10cm high) along bottom. Selective water damage along base and hairline crack to left. No shelves, doors, slatwall or objects.

**Room 11**

6m wide x 3m high, 2:1 ratio. Empty wall of a sixty-year-old cafeteria, upper two thirds plaster painted a faded grey ivory. Lower 0.95m of wall is a wainscot of medium, desaturated, dusty seafoam glazed square tiles about 15x15cm with restrained grey grout, broken/missing tiles in one small patch, thin dull trim at its top, 9cm charcoal toe base. Faint damp stain and a couple of patches on relatively calm upper wall, no hatches, menus or furniture.

**Room 12**

6m wide x 3m high, 2:1 ratio. Bare warm mushroom-grey painted render wall of a cleared shop. Two long pale rectangular GHOST outlines left after removal of fittings, a few dark anchor holes, irregular floor-level salt and exposed brownish grey plaster. Thin dark grey cement plinth (10cm high). No extant fittings, shutters, doors, racks or objects.

**Room 15**

4.5m long x 2.9m tall, aspect ratio 1.55:1. Smoke-damaged bedroom wall, upper third and top edge deeply charred and black in a broad ragged band, soot fingers extending down with soft irregular boundaries. Lower two-thirds a medium desaturated smoke grey plaster, spalled islands exposing underlying brown-grey base, a small length of charred base strip at floor. Dense soot, tonal rather than graphic, no loose hanging debris, no door or furniture.


### Floor, ceiling and material layers

**Shared opening**

A precisely RECTIFIED, flat, orthographic PBR BASE COLOR map for a realistic survival video game in long-abandoned Miami. Material scan style, no perspective or direction of illumination. Square or near square. Only the specified face fills every pixel, as a UV texture, no walls or other faces at the edges, no editorial borders. No text, people, animals, logos or graphics. Even neutral illumination, no cast shadows, no vignette, no view from the side.

**acoustic**

Straight-on perfectly square macro material scan of ONE old midgrey-ivory mineral fiber acoustic ceiling tile, 60cm by 60cm. Consistent matte, tiny short irregular randomly oriented recessed pin-fissures and fine compressed fibre flecks, a faint irregular tan leak tide mark near one edge, minor chipped edge. One tile covers every single pixel; no actual outside edges, seams, black borders, metal frame or fixtures visible. Authentic photographed high-frequency acoustic texture. Broad surface mostly uniform. Zero illumination gradient.

**ceiling07**

Exactly 8 by 8 metre full ceiling orthophoto viewed straight up of a deserted office conference room. Suspended acoustic ceiling, believable perfectly square 0.6m tile grid aligned exactly with axes, 13 tiles across and 13 tiles down, discolored ivory-grey perforated mineral-fibre panels in thin oxidized T runners. A LONG continuous thin linear fluorescent fixture running for about 4m down the central axis of the image, old OFF, dead grey tubes under bent sheet-metal reflector and dull oxidized seams, no glow. A clean, very clear and elongated silhouette at a distance. Grouped soft water stains around one corner and lightly salt-freckled tiles, several chipped edges; rest of tiles calm. No walls at edges. Sparse commercial space, even material values.

**ceiling08**

Square image, entire 8mx8m exposed concrete SOFFIT scanned from exactly below. Wide continuous galvanized sheetmetal ventilation trunk, about .60m wide, passing horizontally across at y=36%, with a shallow rectangular offset elbow after two thirds of travel, and one narrower branch to the top edge. Seamed zinc with slip joints and a couple of suspension straps. Two grouped small parallel electrical conduits crossing one half, a loose draped black cable loop and one torn length, broad mostly open concrete. Concrete formwork marks and uneven light brown water leaks. A few defunct junction boxes. No lights, no grid, no windows or walls or edges of walls. Strong, believable construction, muted, no baked cast shadows. Very strictly parallel projection, full bleed.

**ceiling09**

Entire 8m x 8m office archive CEILING scanned straight from underneath, a perfectly axis-aligned suspended grid of 60cm square acoustic tiles, 13 tiles across and 13 down. Calm warm-grey perforated mineral fibre squares bounded by thin, dull metal grid. Distinctive stormwater tide marks that span several adjacent tiles in the upper left quadrant and one near the lower right; uneven concentric tobacco-grey water rings, some softened edges, a slightly skewed tile. Most of the ceiling still intact, many quiet empty tiles. No fixtures, fans, lights or vents. Do not show walls or perspective. Convincing commercial ceiling material and construction, sober flat desaturated albedo.

**ceiling10**

Landscape, 7.2m across by 6m high. Looking straight up at one old grey-beige painted commercial concrete ceiling, all of it in frame, surrounding walls completely cropped off. One large worn galvanized rectangular duct running vertically just left of center with a curved elbow turning at top right, regular standing seams and hangers; two separate runs of long visibly DEAD, narrow twin fluorescent strip fixtures with oxidized metal housings, dulled grey tubes that have no glow, one missing tube exposes empty sockets. Simple cable conduit, little else. Ceiling slab dominates majority; salt-weathering near the duct seams, no dramatic stains. Flat orthographic albedo. All lines sharp and physically parallel.

**ceiling11**

Landscape near-square image of the entire 7.2m x 6m cafeteria ceiling, seen exactly from BELOW, zero perspective. Faded cream plaster ceiling with fine hairline cracks, broad water damage and a small patch of paint peeled where roof leaked, otherwise quiet. One battered five-blade 1960s cafeteria ceiling fan a little right of center, 1.6m diameter (about one quarter of the image width), broad muted brown wooden paddle blades on dark oxidized metal spider, rounded old metal bottom of motor, no lamps, no light kit, no visible motion. A short surface electrical conduit to fan canopy is fine. Do NOT make the fan dominate the frame. Even unlit texture pass with no cast shadows. No beams, other objects, borders or walls.

**ceiling15**

Entire 4m x 4.5m fire-damaged plasterboard ceiling, looking straight up in orthographic projection. Irregular islands of flaking brown-black char and soot around two large ragged holes through ceiling lining, dull dark concrete slab and several parallel blackened steel furring channels visible behind, broken edges of gypsum are ashy grey and torn, mostly continuous smoked dark plaster elsewhere. Holes combined cover about 25 percent of the surface. A few subtle lath stress cracks and blistering. Highly tactile, broad shapes, no charcoal graphic lines, no empty star-like speckles. Charcoal, smoke grey and soot brown. No fires, daylight, artificial lights, glows or windows. Edge to edge surface only.

**floor06**

A square 8m by 8m expanse of dark grey commercial carpet tiles in an abandoned office, exactly sixteen tiles across the image and sixteen down (each tile 50cm), square edge-to-edge grid aligned to image axes without perspective. Two close shades of charcoal and warm grey carpet forming broad irregular groups with changing alternating nap direction, old low pile commercial fiber. Three or four localized LIFTED tile corners reveal very dark rubber backing and a little decayed glue, a single missing tile. Grey low-saturation color, restrained wear, subtly different neighboring texture orientation. No furniture, no chairs and NO large trails or shadows.

**floor07**

Square top-down survey of EXACTLY one 8 by 8 metre expanse of dusty abandoned grey-blue low pile commercial carpet in a Miami office meeting room. Map edges are the room perimeter, no painted border, no wall. Single long rectangular boat-shaped conference table with rounded corners in deeply faded walnut veneer, split in two sections with a single cross seam, longitudinal grain, a small chipped end revealing particle board. Table long axis VERTICAL in picture. Table centered, 1.55m wide and 4.4m long (approx 20% image width and 55% image height). Six or eight worn drab green-grey upholstered office conference chairs loosely round it, some tipped onto their sides with recognizable five-star bases, top of seats and backs distinctly visible in true orthographic plan; sparse, imperfect, abandoned. Table entirely EMPTY, no accessories. Keep surrounding carpet quiet: a little desaturated salt bloom and faint worn nap, no dramatic grunge. No cast shadows, flat material values. Top-down plan; no wall and no other furniture.

**floor08**

Square image of an 8m x 8m demolished commercial concrete slab FLOOR, top-down diffuse texture. Faint square ghost outlines where carpet tiles were removed, two or three large patches of worn umber adhesive with delicate parallel curved notched-trowel ridges, a rough scrape exposing grey concrete through a patch, a few pieces of broken white-grey plasterboard and short fragments of bent metal track collected in just two small clusters. Leave over 80 percent of the floor bare. Long old tooling joint and one hairline crack. Low to medium contrast, faded putty-taupe and grey, no warm light. Fine material detail but visually peaceful. All edges are just the floor texture, no baseboards, no frames. No writing or fragments with print.

**floor09**

Square image, 8 x 8 metres of grey-green, old mottled, dull commercial vinyl floor of an abandoned archive. Entire floor area, texture scale 30cm square dull vinyl composition tiles with almost invisible seams. Two localized irregular spills of decayed sheets of paper turned to grey-beige pulp, feathered damp scum, a few curled blank dog-eared paper silhouettes still visible at their edges. One spill left of center in back third near top, one smaller spill in right middle. Keep most of the expanse quiet and uncovered. Sparse, medium dark and desaturated. The paper is all blank, disintegrating into fibrous clumps, no lettering or print.

**floor10**

Rectangle, width-to-height ratio 1.2. One whole 7.2 by 6 metre shop floor of large pale grey-beige ceramic tiles, exact straight axis-aligned square grid, 12 columns, 10 rows, 60cm tiles. Medium-grey dirt in the grout. Three or four cracked tiles with convincing hairline fractures splitting two or three neighbouring squares; a single broken corner exposing dull grey mortar. Sparse broad dirty footprints worn away into streaks and a little old adhesive, several cleaner areas. Empty floor right up to all four edges. Weathered matte with no reflection or directional lighting; no furniture, shelves, objects, border, or walls.

**floor11**

Rectangle, width-to-height ratio 1.2. Orthographic worn 1960s cafeteria linoleum floor only, full 7.2m by 6m room. Twelve columns by ten rows of vintage square CHECKERBOARD tiles, slightly yellowed bone-grey alternating with charcoal-grey, muted colors softened by many decades of abrasion and grey flood silt. Absolutely regular horizontal and vertical seam lines, true checker alternation, close enough in value for mid contrast. Occasional broken corner, strip of exposed brown backing, once-waxed dull surface. No stool or table or furniture or walls or border. Straight overhead full-bleed albedo. No specular highlights.

**floor12**

Landscape 1.2:1 flat texture. Entire 7.2x6m bare, dusty faded grey concrete FLOOR of an abandoned shop, old expansion joint seams, restrained flood marks. At x=34%, y=22% of image one convincing localized fallen HEAP of five or six broken large 60x60cm beige fibrous acoustic ceiling panels, snapped corners and exposed yellow-grey core and one bent aluminium T grid member, seen from DIRECTLY ABOVE. Heap occupies only about 1.6x1.7m and leaves lots of surrounding floor quiet. A single small square rusted grey grated drain with parallel slots x=63% y=37%. Fine sand and a few small fragments adjacent to the pile, everywhere else just old concrete. Medium grey base, subtle desaturated brown stains. No perspective, borders, shadows or walls.

**floor15**

Landscape near-square 4m x 4.5m texture of just a burnt bedroom FLOOR viewed from exactly above. Patchy soft medium-charcoal and grey-white chalky ash covers the floor, a few burnt splinters of wood, lengthwise exposed areas of charred reddish-brown floorboards with cracks along the grain; one small cluster of recognizably charred gypsum and cinders and finer ash along one edge, heavy fire damage but leave some empty broad zones. Natural organization where storms have dampened the ash. Room is empty: NO bed, furniture, bedding, tools or prominent objects, these will be added separately. No border or walls at image edges. Keep the top third of the frame mostly flat and plain for later furniture placement. No directional lighting, no glow.


### Isolated inserts

**Stool parts**

Stylized-concept. An orthographic top-down video game asset sprite sheet (2 by 2 grid of spaced individual objects, no dividers) containing FOUR different states of a ruined Miami cafeteria's original fixed counter stools. Truly transparent background with wide clear gaps between each individual object. EXACTLY straight DOWN at the top of each stool, plan view, not isometric and not 3/4. First top left: a single round dark faded oxblood vinyl padded seat, faded streaks, fine pressed circular piping, tarnished chrome rim and small cracked spot. Second top right: same round muted dusty russet-brown seat with a torn crescent exposing tawny foam. Bottom left: JUST the circular tarnished chrome floor flange, four mounting bolts, and the end of an upright broken tubular chrome post seen from above, no upholstery or seat. Bottom right: one bent chrome stool post on circular flange, the round torn vinyl seat still attached but tipped a little sideways revealing a sliver of its underside and some chrome post. Warm dark mulberry and muted rust-grey palette. Each object fully enclosed in its own equal quadrant, isolated and large. Diffuse material pass, no cast shadows, no environment, texture authentically old and tactile. No writing or numbers or square frames.

**Bed spring frame**

A single isolated orthographic TOP-DOWN PBR sprite / texture for a game. Direct overhead plan of a single burned 1930s utilitarian tubular iron bed spring FRAME without mattress or bedding. Long axis horizontal across the page. Roughly 2.1 metres long by 0.90 wide, slender plain perimeter rectangle, two dark brown oxidized steel lateral cross straps, only a handful of remaining sagged zigzag and diamond link wires stretched across center with lots of open empty TRANSPARENT space visible through the bed. Nearly black and grey-brown iron with oxidized patches in a genuinely rectified material scan. Head rail at left, foot rail at right, both seen edge-on from directly above. All four corners visible, flat geometry, no perspective, tight crop with clear transparent margin all round, no ground or shadows or lighting directions, NO boxspring, wood, fabric or bedding, no writing, nothing but the actual iron and wires.

**Recessed office fixture**

Photoreal orthographic albedo texture, 2:1 landscape. One old 1.2m by 0.6m commercial recessed fluorescent ceiling troffer seen from straight beneath. The thin rectangular oxidized grey bezel of the unit exactly borders the image on all four sides, no surrounding ceiling. An aged egg-crate aluminum parabolic louver grid: six large cells horizontally and three rows vertically, dark open cells, slim continuous grey unlit fluorescent tubes behind louver fins, some dust and a small rust spot at a corner. Truly dead and switched off for decades. Flat diffuse material values, mid-to-dark warm greys and dull zinc. Clean square-on rectangle, no perspective, no emissive appearance, no ambient vignette, no walls, no text or labels, no other objects. A PBR texture atlas insert for a weathered office in a videogame.

</details>

