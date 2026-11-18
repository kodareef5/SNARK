# The motor yachts' damage: hurt and decay layers, and the wear stories (the Belvedere first)

You painted the Belvedere's surfaces in an earlier job (`paint.py` and the modules beside it in this folder; read
`ref/SOURCES.md` and your scripts). Now paint what it turns to when hurt and when it rots, as the example for the other
three yachts. Working folder `assets/source/core/vehicles/motor_yachts`; you may also write in `../belvedere`,
`../solstice`, `../meridian` and `../sovereign` (their `tex/` and `ref/`).

## What these pictures do in the game

A vessel is hurt by shots, rams, creatures and fire, and when it is destroyed it becomes a wreck that rots. The engine
shows this with each material's two layer pictures, painted on the same layout as its base:

- `<material>_hurt.png` (RGBA, sRGB): what the surface turns to as the vessel loses health. Its colour takes the place of
  the surface's colour where it shows, and is never dyed by the vessel's colours. Its alpha says how soon a texel shows
  over the three hurt stages: 171 to 255 from the first stage, 86 to 170 from the second, 1 to 85 from the third, 0 never.
  The roughness there goes wet (glossy) while the vessel lives. A mark is a texel's colour, nothing else: the normal and
  the shape do not change, so a dent is painted as its shading (a dark fold, a lit lip), a hole as its dark inside with
  its torn edge, and a crack as the line and the crazing round it.
- `<material>_decay.png` (RGBA, sRGB): what a wreck turns to as it rots, the same way over three decay stages; a wreck
  shows the whole hurt picture from the start. Where a hurt texel has alpha, the decay picture is passed over: leave
  decay alpha 0 there. The engine also dulls and darkens a whole wreck as it decays, so do not darken all of it yourself.

Both pictures are the size of the material's base picture (the pack stores them as fine as the base, up to 2048).

**Wear stories.** Two vessels of a kind must not hurt alike. Each vessel takes one of five stories for good, chosen by its
colours, and the story holds marks back where the vessel was not struck. Over the vessel's bounding box (each axis
-1 to 1 across the mesh's bounds) the story gives, at 3 x 2 x 3 points (x: starboard -0.8, middle 0, port 0.8; y: the
hull below -0.35, the decks and house above 0.45; z: stern -0.7, middle 0, bow 0.7), how many stages later a mark there
shows, blending between the points; "never" (9) holds a hurt mark back until the wreck's last decay stage, and a decay
mark is held back two stages at most. The vessels' five stories (`client/core/render/wear.ts`, the last five rows):

1. holed forward to port: the bow and the port topsides first, the stern and the starboard quarter never;
2. struck astern to starboard: the transom, the drives and the starboard quarter, the bow never;
3. ground along a quay to port: the port side's length, low first, and nothing to starboard;
4. run aground: the bottom and the bow first, the decks and the house late;
5. burnt from above: the house, its glass and the canvas first, the hull late.

So the hurt picture holds **every mark any story shows, spread over the whole vessel**: the bow and the stern, both
sides, the hull and the house, each region with marks that read on their own when only that region shows. Within a
region the alpha still orders its marks by stage (scrapes and crazing first, holes and fire last). Put the heaviest
marks where the stories strike (the bow below the waist, the stern quarters, the rub rail along both sides, the bottom,
the house and its glazing) and lighter ones elsewhere, and keep a good share of the surface clean at every stage: a hurt
boat is a boat with damage on it, not a texture of damage.

## What reads as a boat's

Hurt, by stage: scrapes and rub marks along the topsides and the rub rail, chipped gelcoat at edges and corners, star
crazing round impacts, scuffed and cut upholstery, cracked glass; then gouges into the laminate showing its tan glass
fibre, cracked and sprung panels, shattered glass (crazed, then holed to the dark inside), torn upholstery with its foam
showing, soot round a fire's start; last, stove-in planking and holes at the waterline with torn fibre edges, burnt and
blistered gelcoat, charred canvas and cushions, missing panes. Metal bends rather than breaks: scratched, dented and
twisted rails read by their scratches and dark creases; bronze and stainless scratch bright.

Decay, by stage: salt crust, water spots and haze on glass, bird droppings on what faces up, a slimy green-brown band
and weed at the waterline, tea-staining under every stainless fitting; then chalky oxidised gelcoat where the sun
falls (the paint's colour goes since the layer is undyed: paint the bloom pale), mildew on cushions and in teak seams,
rust runs from cleats, bolts and stanchion bases, a lifting boot stripe, barnacles climbing the bottom; last, thick
fouling, black mould, rotted and split cushions, cracked and missing glass, weathered silver-grey teak with open seams.

## How you look

```
bun tools/art/wear.ts --out /tmp/wear --side 420 core:belvedere       # every stage (columns: whole, hurt 1-3, decay 1-3) in each
                                                           # story (rows: every mark, then the five stories), from the
                                                           # bow quarter and the stern quarter
bun assets/source/core/vehicles/marine/look.ts --out /tmp/look --size 900 --stage 3 --story 7 core:belvedere   # one stage, one story
bun assets/source/core/vehicles/marine/look.ts --out /tmp/look --size 900 --stage 3 --full core:belvedere      # every mark at full size
bun tools/art.ts core:belvedere --check
```

(from `/home/user/dev/SNARK/.claude/worktrees/marine-art`; the vessels' stories are 6 to 10 in these tools, 0 is every mark at once.) Look at each story's row
and ask whether each reads as that event, whether two stories at the same stage look like two different boats' damage,
and whether stage 1 is a lightly hurt boat and stage 3 one barely afloat.


## The job

Write `wear.py` in the family folder so that `python3 wear.py belvedere` paints, from the same bakes and the fields
your painter works out (import them; do not work them out again):

1. `../belvedere/tex/hull_{hurt,decay}.png` (2048) and `house_{hurt,decay}.png` (4096): every mark of the five stories
   over the whole yacht. A yacht's topsides scrape and gouge along a quay and crack round a holing at the waterline,
   their mirror gloss crazes; its boot stripe and antifouling scour away where it grounds; its long dark glazing cracks
   pane by pane and falls in; its white house chips, cracks at the window corners and soots black above a fire; its
   cushions split and burn; its stainless rails scratch and stain; its hardtop and radar arch char from beneath. Rot is
   a Miami marina's: green-brown slime and weed at the waterline climbing the boot stripe, barnacles on the bottom,
   chalky oxidised topsides, rust and tea-staining under every fitting, mildew-black cushions, salt-hazed glass.
2. `tex/teak_{hurt,decay}.png`, 1024 pixels, tiling seamlessly as the teak does: gouges, splinters, scorch and charring
   (hurt); silver-grey weathering, black mould in the seams, lifted and missing caulking, green algae (decay).

The script should take any of the four yachts' names when their turn comes.
