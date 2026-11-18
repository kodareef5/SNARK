## This job: shutters, sign bands, clearance bars and doors

Fourteen elements, each in its own folder. Sizes are width by height in pixels, then in metres; 256 pixels a metre. None of these has glass, so their base colour's alpha is 255 everywhere except where a door has a glass panel (alpha 0 there).

### Roller shutters

- `shutter-0`, `shutter-1`, `shutter-2`: 1856 by 752 (7.2 m by 2.9 m). A shop's roller shutter pulled down over its display and door, seen from the street. Horizontal curved slats 8 cm high, interlocking, running the full width; a deeper bottom rail (12 cm) at the foot with a lock and two lifting handles; narrow steel guide channels 6 cm wide at the left and right edges running the full height. The slats are galvanised or painted steel gone dull. A dented run: at one place a slat band is pushed in and kinked over 1 to 2 m, as if hit by something, with the paint cracked off at the creases. Variants: 0 blue-grey paint, faded and chalky, rust at the bottom rail and running down from the guides; 1 bare galvanised steel gone grey-white with rust spots and a rusted-through hole low down (alpha 0 in the hole, a dark gap); 2 cream paint, heavily faded, a large patch of the paint lost to grey primer and rust. No graffiti (the game adds its own). Relief: the slat profile, 15 to 20 mm; the dent deeper.

### Sign bands

- `sign-0` to `sign-5`: 1856 by 240 (7.2 m by 0.9 m). The fascia band over a shop front, with the shop's name. The band itself is painted render or a metal fascia panel; the lettering is painted or cut letters fixed to it, now faded, letters missing or hanging. Use exactly these made-up names and nothing else written (they are invented; no other name, logo, phone number or slogan):
  - `sign-0`: FARMACIA BAHIA, with a simple cross shape beside it; pale green band, dark green letters faded.
  - `sign-1`: FERRETERIA EL ANCLA, with a small anchor shape; white band, red letters faded to pink, two letters gone leaving their ghost.
  - `sign-2`: CAFETERIA LA GARZA, a heron outline; cream band, brown script letters.
  - `sign-3`: LAVANDERIA OLAS, three wave lines; pale blue band, navy letters.
  - `sign-4`: KORVAN ELECTRONICS and the number 1420 at the right; grey metal fascia with cut metal letters, some hanging askew.
  - `sign-5`: SEAGRAPE BEAUTY SUPPLY; faded coral band, white letters peeling.
  The lettering fills about 60% of the band's height and is centred, as a sign painter would set it. Bands are weathered: water runs from the top edge, sun fading on the upper half, a crack or two in the render. Relief: cut letters stand 10 to 20 mm, painted ones are flat; `relief_mm` up to 20.

### Clearance bars

- `bar-0`, `bar-1`: 1744 by 64 (6.8 m by 0.25 m). The steel bar hung across a parking garage's way in to show its height. 0: yellow and black diagonal stripes 25 cm wide, faded and scraped where vehicles hit it, with "CLEARANCE 2.1 m" in black letters on a yellow panel in the middle; 1: plain faded yellow with "2.1 m" in black at both ends and scrape marks. Steel; the paint chipped to rust at the scrapes. Relief small, 4 mm.

### Doors

- `door-0`, `door-1`, `door-2`: 256 by 576 (1.0 m by 2.2 m). Each is a door leaf with its frame round it, the frame running to the picture's edges (about 6 cm), seen from outside.
  - `door-0`: a shop's glazed aluminium door: a narrow aluminium frame (10 cm stiles, a 20 cm bottom rail), one large glass panel (alpha 0), a long vertical pull handle, a lock at 1 m, a kick plate at the foot. Silver aluminium gone chalky.
  - `door-1`: a flat block's entrance door: painted timber in four raised panels, a brass-coloured handle and lock at 1 m gone dark, the paint (faded teal) peeling to grey wood at the foot and round the handle, a small glazed vision panel high up (alpha 0).
  - `door-2`: a steel service door: flat painted steel (faded red-brown) with a lever handle, a push bar plate, rust bleeding from its bottom corners and hinges, a ventilation louvre low down. Metal 255 where the paint is lost.
  Relief: panels and mouldings 10 to 20 mm, handles 50 mm; `relief_mm` about 60.
