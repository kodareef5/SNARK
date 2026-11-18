# Miami facade elements

Fourteen edge-to-edge materials are ready in their named folders. Each contains six aligned texture maps and its measured relief in millimetres. The three shutters have the same slat pitch. The six shops have individual lettering layouts, and the doors share a frame width of approximately 6 cm.

## Visual checks

- The contact sheet uses 128 pixels per metre for every element. Dark blue-grey fills the two glazed openings. The dark brown-grey spot in the galvanised shutter is its perforation. [Contact sheet](checks/sheet.png)
- The lighting proof multiplies linear base colour by ambient light plus a diffuse term from the saved normal. Sun elevations are measured above the ground horizon of a vertical facade. The two 15° lights have opposite horizontal directions and the same upward component. Compare the jambs and the sides of the timber mouldings to see the light reverse. The 70° light shows the shutter crowns and the folded louvre blades. [Relighting proof](checks/relit.png)
- The distance proof averages in linear colour at 1/8 and 1/32 of the source dimensions, rounded to whole pixels. At 1/8, each sign is 232 × 30 pixels and each door is 32 × 72. At 1/32, a clearance bar is only two pixels high. [Distance proof](checks/far.png)
- The layer proof uses the same crop of the timber door seven times, showing the base RGB and its alpha separately. The drip paths at the top of the pane appear in roughness. The glass remains planar, with fully open occlusion. The lever is visible in height, normal and metal. [Aligned layers](checks/layers.png)

## Shutters

The 35 curved steel slats have a pitch of 79 mm and a crest-to-joint relief of 17.4 mm outside the impact area. The 12 cm bottom rail carries a cylinder lock and two bent lifting handles. Each local dent displaces the joint line as well as pushing the surface inward. The relief in each JSON spans the deepest fold or opening through the proudest hardware.

| Element | Construction | What I saw | Remaining limitation |
|---|---|---|---|
| shutter-0 | Blue-grey enamel over steel, with chalk bloom on the flats, oxide on the foot rail and narrow runs beside the guides. | Under grazing light, the joint kinks right of centre and returns to its regular pitch on both sides. The blue-grey body stays distinct at 1/32. | The guide runoff is faint at street distance. The foot rail carries most of the visible corrosion there. |
| shutter-1 | Zinc swatches supply the irregular spangle. Oxide spots surround a ragged 1,527-pixel opening low on the right. | The pale curtain, left-hand dent and dark perforation read separately at 1/8. A close view separates the oxide rim from the hole. | The zinc mottling competes with the shallow crease under high light. |
| shutter-2 | A cream topcoat breaks back to primer and rust in a broad patch. The paint-loss boundary changes on each slat. | The interlocks continue across the broken coat. At 1/32 the patch still identifies this shutter. | The large patch draws the eye before the separate kink to its right. |

## Sign bands

I set the names at their final widths and drew the cross, anchor, heron and three waves separately. The principal lettering occupies 55–63% of the band height. Paint loss reveals the fascia underneath. Only the hardware-shop and electronics-shop letters stand proud.

| Element | Construction | What I saw | Remaining limitation |
|---|---|---|---|
| sign-0 | A dark green cross and geometric capitals are painted onto pale green render between two fine rules. | The cross stays distinct from the name at 1/8. The oblique sun picks out the cracked render while the letter faces stay flat. | The thin perimeter rules largely disappear at 1/32. |
| sign-1 | Rose-painted cut letters stand 12.2 mm above the folded off-white face. The second R in FERRETERIA and the N in ANCLA survive as ghosts with exposed stud holes. | The two ghosts remain legible at 1/8. The surviving letters catch oblique light along their edges. | At 1/32 the pale ghosts become breaks in the word shapes. |
| sign-2 | Brown brush capitals, a tapered underline and an outlined wading heron share a cream render face. | The bill, folded neck, wing and legs separate on the contact sheet. The corrected lettering and underline run cleanly through GARZA. | The heron's legs and inner wing line merge first at distance. |
| sign-3 | Three painted wave strokes accompany oblique navy capitals on a pale blue folded panel with small fasteners. | All three waves and both words remain distinct at 1/8. Under side light the fasteners stand proud and the waves stay flat. | At 1/32 the wave strokes become a single short mark. |
| sign-4 | Dark cut-metal lettering is fixed to a grey metal fascia. Two letters rotate and drop around their mounts. A panel joint separates the name from 1420. | The V and the R in ELECTRONICS interrupt the baseline. The number remains readable in the 1/8 view. | The smaller tilt is subtle once the sign is reduced. |
| sign-5 | Ivory serif capitals and paired hairline rules are painted over coral render. Gaps in the strokes reveal the coral coat. | The three words remain distinct at 1/8 after opening the word spacing. The larger flakes still read as missing pigment in the close view. | The fine serif strokes make this the least legible name at 1/32. |

## Clearance bars

| Element | Construction | What I saw | Remaining limitation |
|---|---|---|---|
| bar-0 | The 45° stripes are 25 cm wide measured perpendicular to their edges. The centre legend and yellow field are painted flat. Scrapes cut shallow grooves into the face. | The stripes continue to identify the bar at 1/32. In grazing light, the tube edges and end fixings respond while the stripe boundaries stay flat. | At 1/8 the centre legend is already small. At 1/32 the hazard pattern carries the message. |
| bar-1 | Matching end legends sit on faded yellow steel. Discontinuous parallel scars expose steel and rust in three impact areas. | Both end markings are visible at 1/8. The longer scrapes can be followed across the native-resolution face. | The plain middle and the wall are close in value, so the far bar relies on its yellow hue. |

## Doors

| Element | Construction | What I saw | Remaining limitation |
|---|---|---|---|
| door-0 | Aluminium stiles and rails enclose a single gasketed pane. An offset vertical pull fastens to the latch stile above the cylinder. A screwed kick plate spans the foot. | Glass occupies 48.13% of the image. Its mask follows behind the solid pull, and the keyway is clear of the lower mount. The pale frame encloses the dark opening at 1/32. | The pull approaches the right-hand frame line at 1/8 and merges with it farther away. |
| door-1 | Four raised timber panels sit beneath a small glazed light. Flaked teal paint exposes grey end grain at the foot and wood around the dark brass handle. | The vision panel occupies 4.23% of the face. The side lights reverse across the equal-width mouldings. The layer crop shows the brass lever above the panel beneath it. | The unlit 1/8 view has lower panel contrast than the relit view. |
| door-2 | The red-brown steel leaf has three knuckled hinges, a riveted push plate, a lever and six folded ventilation blades. Rust spreads from the lower corners and runs from the hinges. | The push plate and low grille occupy separate areas at 1/8. The high light resolves the six blade lips. | At 1/32 the grille becomes a single dark rectangle. |

## Map verification

I checked the headers, dimensions and decoded pixels of all 84 material PNGs. Each base is 8-bit RGBA tagged sRGB. Each 16-bit greyscale height reaches both 0 and 65,535. The normal maps are 8-bit RGB. Roughness, metal and occlusion are single-channel 8-bit data maps.

I derived normals from the saved height range and the specified physical width and height of each face. An independent double-precision reconstruction agreed within one 8-bit channel value at every pixel. I also recomputed cavity visibility at 250 sampled positions per element using the surrounding relief in eight directions.

Alpha and metal masks use only 0 and 255. Both panes have a constant height, zero metal, occlusion 255 and roughness within 0.04–0.60 to 8-bit precision. The shutter perforation is the only other transparent area. The proofs use a fixed colour behind glass. The final room, reflection and salt-film blend depend on the game shader.

## Material source

I used the built-in image generator for a single four-finish swatch sheet. Overlapping crops supplied pigment and grain variation at native resolution. The profiles, fixings, dents, panel fields, glyph masks, scratches and drip paths were built at each element's delivery dimensions.

<details>
<summary>Swatch generation prompt</summary>

> Create a single square, straight-on archival flatbed material scan for a game material artist, a full-bleed 2 by 2 atlas of four different physical surface finishes. No framing or margin, no gaps, four equal quadrants. Top left: timeworn grey-blue oil enamel on steel, with a mostly intact chalked eggshell finish interrupted by small islands of jagged flaking, subdued grey undercoat, and minute ferrous blooms. Top right: grey-white aged hot dip galvanised steel, subtle zinc spangle and matte white oxide, very sparse iron freckles. Bottom left: dry sun-bleached painted mineral render, pale warm cream limewash, fine granular pores, irregular rubbed remnants of a slightly older coat, hairline checking. Bottom right: grey weathered tight-grained painted wood with its grain running vertically, some pale teal paint hanging on in fine narrow splintered strips. Each quadrant depicting a large approximately 2 square metre surface with fine detail. Natural materials in flat diffuse scanner illumination, absolutely no direction of light, shadow, edge vignetting, reflection, objects, joins, lettering, labels, lettering-like marks, graphic design or borders. No large uniformly distributed chips, these are remarkably intact surfaces with localized material failure. Texture fidelity of real old buildings in a humid coastal town.

</details>
