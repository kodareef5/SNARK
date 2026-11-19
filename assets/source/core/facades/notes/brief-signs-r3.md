## This job: ten more sign bands, and one shop display cleaned

Read `common.md` in this folder first: it is the brief every element is painted to (what an element is, the maps, the checks, how it is judged). Eleven elements, each in its own folder. Sizes are width by height in pixels, then in metres; 256 pixels a metre.

`reference-street.png` is the game's shop row today, with the six sign bands painted in an earlier round on it; `existing-signs.png` shows those six. A street of shops now repeats them too often. The ten new ones must each look unlike those six and unlike each other: a different hand of lettering, a different colour of band, a different material.

### Sign bands

`sign-6` to `sign-15`: 1856 by 240 (7.2 m by 0.9 m). The fascia band over a shop front with the shop's name, as in `existing-signs.png`: painted render, a metal fascia panel or tiles, the lettering painted, cut or fixed to it, now faded, letters missing or hanging, water run from the top edge, sun fading on the upper half, a crack or two. The lettering fills about 60% of the band's height and is centred, as a sign painter would set it. Use exactly these made-up names and nothing else written (they are invented; no other word, name, logo, phone number, slogan or number):

- `sign-6`: PANADERIA LOS CORALES, with a simple wheat-sheaf shape; brush script in dark brown on a faded mustard band.
- `sign-7`: MUEBLERIA ISLETA; wide blocky capitals in white on a faded navy band.
- `sign-8`: VELOZ PHONE REPAIR, with a simple lightning-bolt shape; condensed italic capitals in black on a faded yellow band.
- `sign-9`: BARBERIA EL FARO, with a striped barber's-pole shape at each end; slab-serif capitals in oxblood on a cream band.
- `sign-10`: MARISCOS PUNTA BRAVA, with a fish outline; rounded hand-painted letters in off-white on a faded teal band.
- `sign-11`: OPTICA CLARIDAD, with a pair of round spectacles drawn as a shape; thin geometric deco capitals in black on a lavender-grey render band.
- `sign-12`: BODEGA LA PALMITA, with a palm outline: old unlit neon, glass tubes bent into script letters on standoffs over a dark green-grey metal band, many tubes broken off or missing, their clips and wiring left; the tubes stand 30 to 40 mm proud.
- `sign-13`: LIBRERIA PAPEL Y TINTA, with an open book shape; serif small capitals in charcoal on an off-white band.
- `sign-14`: DIEZ MILLAS AUTO PARTS; stencil capitals in black on a faded brick-red band.
- `sign-15`: FLORISTERIA BUGANVILIA, with a simple flower shape; letters set in small mosaic tiles, faded magenta, on a band of terracotta tiles with some tiles fallen out (the render behind showing grey).

Relief: painted letters are flat, cut or fixed letters stand 10 to 20 mm, neon tubes 30 to 40 mm, tiles 5 mm with their joints; give each `relief_mm`.

### One display, cleaned

`display-1-current/` holds the earlier round's `display-1` (5 m by 2.4 m, 1280 by 624, dark bronze aluminium shop lights), all its maps. Deliver `display-1/` the same in every map and every pixel but one thing: the faded rectangular frame line of peeled vinyl in its middle light is gone. The glass there is glass like the rest of that light (alpha 0, the same salt film and roughness continued across), and nothing of the line remains in any map. The game now lays such remains over its displays itself, in a different place on each.

Write `REPORT.md` for this job, and the checks `common.md` asks for (for the signs, `checks/far.png` at 1/8 must still read each name).
