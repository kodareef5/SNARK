# The small craft's own pictures: the Thunderbolt first

You are the painter for four original small craft of one family: the Needle (a 10 m centreline race launch), the
Thunderbolt (a 13 m offshore performance boat), a 4.4 m aluminium jon boat, and the Riptide (a 3.3 m two-rider jet
ski). Paint the Thunderbolt now, completely, as the example for the other three. Your working folder is
`assets/source/core/vehicles/performance_marine` (the family's), and you may also write in `../thunderbolt`,
`../needle`, `../jon_boat` and `../riptide` (only their `tex/` and `ref/`).

## The game and what the pictures are for

SNARK is a survival game set in a ruined Miami. Its vehicles include ten original powerboats, found berthed in marinas, some
whole and some hurt, which players drive. The people who make the game want these boats to impress: each must look like
itself, and look expensive where it should. They are drawn up close (from the helm, walking the decks), from a dock 10 m
away, and from 100 m across a harbour, at noon and under a low sun.

Today each boat is painted with a 4x4 atlas of flat swatches (noise over one colour), stretched over each part: no
occlusion, no waterline, no name, nothing that says it is a boat. Each boat now has its own pictures, laid out so that
every texel is one place on the boat (the layout is done; `../marine/layout.py`), and a bake of where each texel is.
Your job is to paint them, as well as they can be painted. The best examples on this project so far, to beat:

- the compact car: `../compact/tex/paint.py` (paints a car from the same kind of bake: clear coat, road film settled low
  and in what light does not reach, stitching, dials), its review pictures in `../compact/ref/review/`;
- the launch, a 7 m utility boat: `../boat/tex/paint.py` and `../boat/tex/surface.py`, `../boat/ref/review/hero.png`.

## What you paint from

`python3 ../marine/bake.py` has already run (do not run it again). For each of a boat's own materials it left
`<boat>/tex/bakes/<material>.npz` and `<material>_occlusion.png`. Read them with `../marine/surface.py`:

```python
import sys; sys.path.insert(0, "<path to>/marine")
from surface import Surface
s = Surface("<boat>/tex/bakes", "hull")   # s.size is the picture's side
s.P, s.N      # position and normal of every texel, metres, in the game's frame: +X port, +Y up, +Z bow; keel at y = 0
s.TAG, s.tags # each texel's tag (what the face is, as the shipyard named it), an index into s.tags
s.PART, s.parts  # the part each texel belongs to (the shipyard's object names, such as "lifting strake.003")
s.AO          # the share of open sky each texel sees within about a metre (occlusion), 0 to 1
s.MPT         # metres a texel spans there; s.covered: whether a face covers the texel
s.where("gel", "pearl")  # texels with those tags; s.on("strake") texels of parts whose name holds "strake"
```

Texels that no face covers carry the nearest covered texel's values, so painting every texel from its position fills
the gutters between charts, as the mips need. Paint from position, normal, tag, part and occlusion: a waterline is a
height, a name is a place on the topsides, grime gathers where the occlusion is deep and the surface faces up, streaks
run down from fittings. Charts meet without seams because both sides of a seam are painted from the same point.
The shipyard that built the boat (read it for what each part is and where): `shipyard.py` with `offshore.py`, `skiff.py`, `personal.py` and `drive.py` in the family folder.

## What the engine needs of each picture

All pictures square and of the side the bake gives (`s.size`); 8-bit PNG unless said.

- `<material>_base.png`: base colour, sRGB, unlit: no baked light from a direction (the engine lights it), but the
  occlusion may darken creases and the undersides a little. Alpha is cut-out: this picture is not cut out: alpha 255 everywhere.
- `<material>_normal.png`: tangent-space normal, x in red, y in green pointing UP the picture (rows run down, so +y is
  toward row 0), z in blue; 128,128,255 is flat. It must be the slope of the height picture: the checker holds the two
  together (it reads the normal map at the height's size and fails one that leans against it).
- `<material>_height.png`: the height the normal map is the slope of, 8 or 16-bit grey, kept for the record.
- `<material>_packed.png`: occlusion in red, roughness in green, metalness in blue, each 0 to 255. Gelcoat and paint
  are glossy dielectrics (roughness about 0.12 to 0.3, metal 0); stainless is metal 1 and smooth; rubber, canvas and
  upholstery rough; glass glossy. The occlusion here is what the engine darkens ambient light by: use the bake.
- `<material>_mask.png`: colour regions, red = region 0, green = region 1, blue = region 2, black = not dyed; the three
  never sum past 255. Where a region dyes, the game multiplies the base by (the player's colour / the mean brightness of
  the base where that region is): so the base under a dyed region must be NEUTRAL grey or white, carrying only light
  and dark (occlusion, orange peel, a graphic's shading), never the hue. The colour regions: region 0 (red) is the boat's own colour: the hull band tagged `gel` and any graphic you paint in the boat's colour; region 1 (green) is the upholstery: the seat covers (`vinyl`, `suede`), not their piping (the jon boat has region 0 only). Nothing else is dyed.
- `<material>_hurt.png` and `<material>_decay.png`: what the surface turns to as the boat is hurt and as it decays.
  This job does not paint them: write both fully transparent (RGBA, alpha 0 everywhere) at the base's size. A later job
  paints them, and paints the boat's wreck forms, from the fields your script works out: write it so that those fields
  (which texels are gelcoat, glass, upholstery, the waterline, each graphic's mask, the name's place) can be imported
  and reused rather than worked out again.

## Lettering and graphics

Names, registration numbers and hull graphics are painted into the pictures at their places. They must be original:
no real maker's name, logo or livery, and nothing copied. A free font is in the repository,
`assets/raw/fonts/barlow/BarlowSemiCondensed-Medium.ttf` (OFL); you may also draw lettering and graphics yourself, or
make them with your image tool as clean flat artwork and turn that into masks. Keep any generated originals in the
family's `ref/` folder at full size and say in `ref/SOURCES.md` which picture came from where and which model made it.

## How you check your work

The boat's pack is built for this layout already. After writing the pictures, draw the boat with the game's own
rasterizer and look at every view, at full size, as a buyer would:

```
bun assets/source/core/vehicles/marine/look.ts --out /tmp/look --size 900 core:thunderbolt           # all views, out of the water
bun assets/source/core/vehicles/marine/look.ts --out /tmp/look --size 900 --afloat core:thunderbolt  # what lies under the waterline hidden
bun assets/source/core/vehicles/marine/look.ts --out /tmp/look --size 900 --colors 232,230 core:thunderbolt  # other colours (palette indices)
bun tools/art.ts core:thunderbolt --check                                                           # the art checker: must say "ok"
```

(run them from the repository root, `/home/user/dev/SNARK/.claude/worktrees/marine-art`). Palette colours to try: 232 white, 230 near black, 29 navy, 46 red, 84
graphite, 104 cream, 101 warm grey, 87 steel grey. Do not run `bun tools/art.ts` without `--check`, and do not run the
bake. Look hard and paint again until it would sell the boat: then check what a texel looks like up close from the
helm view, not only the whole boat.

## Rules

- Write only in the folders given below. Do not change the bakes, the shipyard, `spec.ts`, `layout.py`, `surface.py`
  or anything outside those folders.
- Python 3 with NumPy, SciPy and Pillow; seeded, so a second run makes the same pictures; a few minutes at most.
- No names of people, companies, tools or models in the scripts' comments or in file names. Comments few and plain.
- Put nothing about any person in any file.
- At the end, write `ref/SOURCES.md` in the family folder (what makes each picture, how to make them again) and report:
  what you painted and how, what you looked at, what you judged good and what you would still improve.


## The job

Write `paint.py` in the family folder (replacing the old swatch painter there) so that `python3 paint.py thunderbolt`
paints:

1. **The Thunderbolt's own picture**, `../thunderbolt/tex/shell_{base,normal,height,packed,mask,hurt,decay}.png`, 2048
   pixels (the bake's size). Every moulded, painted, upholstered, glazed and wooden face of the boat is on it.
2. **The family's fittings atlas**, `tex/hardware_{base,normal,height,packed,mask,hurt,decay}.png`, 1024 pixels: a 4x4
   grid of 256 pixel cells, one finish each in the order of `finishes.py` `FITTINGS` (row by row from the top left);
   the last three cells are spare. Each small fitting's faces are box-projected onto 92% of its finish's cell, stretched
   over the part's bounding box, so a cell is a material seen at any scale: polished and brushed stainless that read as
   metal, black rubber, an instrument dial filling the gauge cell, a chartplotter screen in the chart cell, a wheel
   rim's grip, a black vent grille, red, green and white lamp lenses, a throttle knob, dark anodised vanes, nickel
   bronze for the propellers. The mask is black: nothing there is dyed. This atlas is shared by all four craft.

The Thunderbolt: 13.0 m overall, the transom at z = -5.87 and the stem at z = +6.5, beam 2.9 m, 2.1 m tall; the
waterline at rest is y = 0.58; the cockpit sole is about y = 0.69 and the deck rises from about 1.2 m aft to 1.55 m at
the bow. Twin sterndrives at the transom, two teak swim platforms either side of them, a recovery ladder to port. A deep
V with two running strakes a side, a navy (`midnight`) bottom to the chine, then the band the shipyard tags `gel` (the
boat's own colour, region 0) between two `gold` pinstripes, a black `rubber` rub rail, ivory `pearl` upper topsides and
a crowned ivory deck with flush skylights, a five-seat open cockpit (two helm bolsters, a three-seat aft lounge), a sun
lounge of three crowned cushions on the engine hatch, a `screen` swept acrylic wind deflector, a dashboard with gauges
and a chartplotter. Think of the best offshore boats kept at a Miami marina: deep wet-looking gelcoat, a hull graphic
that sweeps aft in the boat's colour, gold-leaf pinstriping, marine vinyl with piped and stitched panels, teak with
black seams, nonskid where feet go, polished stainless. Fast and expensive, and it should make a player want it.

Its name is HIGH VOLTAGE (lettered on each side aft, or across the transom, as such boats carry it), and its
registration FL 4821 TB, in block letters about 8 cm tall on each side of the bow, as Florida requires. No maker's
name: the boat's model is the game's own.

The other three (later jobs, same script): the Needle, red race launch, name STILETTO, FL 2207 KX; the jon boat, a
painted aluminium workboat (dents, rivets, weld seams, scuffed paint: a workboat should look it), FL 0915 HR, no name;
the Riptide, a jet ski with bold graphics and FL 6630 PW. The paint script should take a boat's name and draw any of
them when its turn comes; for now only the Thunderbolt and the atlas.
