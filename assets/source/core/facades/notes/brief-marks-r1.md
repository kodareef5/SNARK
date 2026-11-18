# Marks on the walls of a browser game: posters, sprayed tags, two large pieces, painted garage markings

You are painting marks that the game lays over its building walls, for a survival game set in Miami decades after people left it: salt, sun, hurricanes and tropical rain have had the city to themselves. Work only in the current folder. You may write and run scripts (Python with Pillow, numpy and scipy are installed) and use the image generation tool as often as you like.

## How the game uses what you paint

Each mark is a decal: the game places it, sparse and by chance, on a wall (concrete, plaster, a roller shutter), at the size given, and shows the wall wherever the mark's alpha is 0. See `reference-street.png` for the game's street today (the walls here will soon carry these). Marks are seen at 3 m, where a poster's tear and a tag's overspray show, at 15 m across a street, where the mark is a patch of colour and shape about 30 to 60 pixels across, and at 60 m, where it is a few pixels.

The marks are old: years of sun have faded the inks and paints toward pale and chalky, rain has washed them, posters have torn, peeled at their corners and lost pieces, sprayed paint has worn thin on the wall's high points. Muted, believable colour: a tag that was bright red is now a dusty pink-red. Nothing glossy or new.

## What to deliver

For each mark a folder named as given (for example `poster-0/`) holding `base.png`: 8-bit RGBA, sRGB, exactly the size given (256 pixels a metre), the mark's colour where it is and **alpha 0 everywhere the wall shows** (around the mark, in a tear, between a tag's strokes). Lit evenly: no shadow, no light from one side, no wall texture behind the mark (the game supplies the wall): only the paper or the paint itself. A poster's paper carries its own fibres, creases and water stains; its peeled corner is simply missing (alpha 0) or curled (a paler underside). Sprayed paint has soft overspray at its edges in the alpha (partial alpha), drips, and thinner coverage where the can moved fast.

And for the whole job `REPORT.md` (how each was made, what you checked, what you are not satisfied with) and `checks/sheet.png`: every mark over a mid-grey concrete-like wall at its true size relative to the others, and the same shrunk to 1/8.

## Writing: only what is given here

No real brand, shop, company, product, band, venue, place of business, person's name or logo may appear anywhere. Every word on a poster or in a tag is given below; write nothing else, and no other numbers. No people, faces or bodies in any picture on a poster. Lettering on posters is printed or hand-lettered; tags are hand-sprayed letterforms in a graffiti hand.

## The marks

Posters, 154 by 230 pixels (0.6 m by 0.9 m), paper pasted to the wall, each torn and peeled differently, some with remains of an older poster under a torn corner:
- `poster-0`: a civic notice in black on faded yellow: "HURRICANE SHELTER" over a big arrow pointing right, then "ZONE B". Stencil-like type.
- `poster-1`: a dance-night bill: "NOCHE DE SALSA" big, "CLUB MAREA" smaller, "SABADO" below; a simple drawn palm and wave in two faded colours (teal, coral).
- `poster-2`: a hand-lettered sheet: "ROOM FOR RENT" and "2 BR", with a row of tear-off tabs along the bottom, half of them torn off.
- `poster-3`: a boxing-night bill in red and black: "FIGHT NIGHT" and "SALON PALMAR", with two crossed gloves drawn as simple shapes (no people).
- `poster-4`: a lost-cat sheet: "LOST CAT" big, a simple ink drawing of a grey cat, "GRIS" under it.
- `poster-5`: a printed notice in blue on white: "BOIL WATER NOTICE" and a few lines of small grey bars standing for unreadable small print (not letters).

Tags, 256 by 128 pixels (1.0 m by 0.5 m), sprayed quickly in one colour, sometimes with a thin outline in a second:
- `tag-0` "KZR", `tag-1` "MOKO", `tag-2` "TREVA", `tag-3` "ZUMB", `tag-4` "OSKE", `tag-5` "VEYL", `tag-6` "RIFT", `tag-7` "NAKO". Each in a different hand (sharp, bubbly, scratchy, blocky) and colour (black, faded red, sun-bleached blue, silver, white, dusty green, faded orange, purple-grey). Letters may be stylised past easy reading, as tags are.

Large pieces, 820 by 308 pixels (3.2 m by 1.2 m), the work of someone who had time: filled letters with outline, highlights and a simple background shape:
- `piece-0`: "MAREA" in bubble letters, faded aqua fill, darker blue outline, a coral backdrop cloud, flaked and washed out over a third of it.
- `piece-1`: "SALTWATER" in an interlocking angular style, faded violet and lime, worn thin in streaks where rain ran down.

Painted markings on a parking garage's columns, 154 by 205 pixels (0.6 m by 0.8 m), stencilled in paint, scuffed by bumpers at the bottom:
- `stencil-0`: a big "2" in white inside a black-edged circle, the level number.
- `stencil-1`: a big "3" in yellow, the same style.
- `stencil-2`: a thick white arrow pointing up with "SALIDA" under it.
- `stencil-3`: a black and yellow diagonal-striped band 0.25 m high across the bottom of the area (the rest alpha 0), as painted round a column's foot.

## How it will be judged

Over our own walls at 3 m, 15 m and 60 m in sun and shade. Sent back: anything written that is not given above; any real name, brand or logo; people; a wall painted behind the mark; shading or a light direction; colours that look new; edges that are pixel-hard where paper or paint would be soft; a mark that does not fill its picture sensibly.
