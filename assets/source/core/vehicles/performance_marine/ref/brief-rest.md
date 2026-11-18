# The rest of the family: the Needle, the jon boat and the Riptide

The first vessel of this family is painted end to end: its surfaces (`paint.py`), its hurt and decay layers and wear
stories (`wear.py`) and its two wreck forms' pictures (`wrecks.py`), and each was judged and sent round until it was
right. Now do the same for the Needle, the jon boat and the Riptide, to the same bar, with everything those rounds taught. Each vessel and each of its
forms must be checked by you as the first one was before you move on to the next. You may write in `performance_marine` and in
each vessel's folder and its two forms' folders: `../needle`, `../needle_damaged`, `../needle_sunk`, `../jon_boat`, `../jon_boat_damaged`, `../jon_boat_sunk`, `../riptide`, `../riptide_damaged`, `../riptide_sunk`.

## What the first one taught, to apply from the start

These were judged on the first vessel of the family, from the dock, the helm and 100 m, at noon and under a low sun,
dry, afloat, at full texture size, in the water through the whole client and on a real GPU. Apply them to each of
these vessels from the start:

- **Stainless must read as metal**, not as flat bands of sky blue: bright highlights and dark reflected shapes along a
  tube, brushed roughness where hands go, occlusion and grime toward the feet of fittings.
- **Displays must read from the seat**: the helm's charts, engine pages and keys have more texels than the rest; use them.
- **Each vessel its own identity**: its own name lettering, its own hull graphic, its own colour logic; nothing copied
  from its sisters but the family's quality.
- **Damage is coherent wounds, not texture**: each story's main impact one wound of its own shape (a holed hull a dark
  deep breach with a jagged fringe of torn glass fibre and lifted gelcoat round its lip and crazing radiating from it; a
  quay scrape a long gouge and rub band with black fender smears; grounding long keel and chine scores; a stern strike a
  crushed corner), lighter chips, scratches and crazing scattered elsewhere, and a good share of the surface clean.
- **Fire is smooth gradients**: a black char core, brown and amber scorch, grey soot streaking upward, blistered gelcoat
  at the edge, melted and split vinyl; never thresholded noise blocks.
- **Broken glass and acrylic frost white round the impact**, cracks vary in width, and a gone pane shows the dark inside
  with shards left in its frame; never clean white drawn lines.
- **Decay is a Miami marina's neglect**, not more damage: a green-brown slime band and weed at the waterline, chalky
  bloom on sun-facing gelcoat, rust and tea-stain runs below fittings, mildew on cushions, salt crust, silvered teak.

## The rest of the family's state

Each of these vessels is laid out and baked (`<vessel>/tex/bakes`, `layout.json`) and its pack is built on flat
placeholder pictures, as are its two wreck forms' packs (`<vessel>_damaged`, `<vessel>_sunk`); the forms' measures are
in `/home/user/dev/SNARK/.claude/worktrees/marine-art/assets/source/core/vehicles/marine/forms.json` (heel, trim, dents, whether it burnt, its slump), which
moved there from `content/vehicles/`. A city's harbours set a damaged form down with its keel 1.25 draughts under the
water and a sunk form with its keel on the bed, in water between its draught and 70% of its height: paint the
damaged forms' water line there. Draw and check every vessel and form with the same tools as before (`look.ts`,
`tools/art/wear.ts`, `bun tools/art.ts <id> --check`).

## The vessels

- **Needle** (`../needle`, 2048): a 10 m centreline race launch (transom z -4.46, bow +5.0; beam 2.2; waterline y 0.43;
  two tandem race buckets, a single sterndrive, twin ram-air scoops aft, a carbon cockpit, a flush foredeck hatch). An
  offshore race boat, loud and lean: the boat's colour over a pearl deck with graphite and vermilion accents, a race
  number (07) on the hull sides and the deck, carbon weave in the cockpit, suede race buckets. Name STILETTO, FL 2207 KX.
- **Jon boat** (`../jon_boat`, 2048): a 4.4 m flat-bottomed aluminium workboat (painted olive hull sides and floor, bare
  aluminium gunwales, ribs and corrugations, thwarts, a side console, a clamp-on outboard, a fuel can). A workboat must
  look it: rolled and riveted seams, weld beads, dents, scuffed and touched-up paint, oxidised bare aluminium, a
  sun-faded console, hand-cut stencil numbers FL 0915 HR on the bow, no name; the outboard's cowl without a maker's
  mark. Region 0 only. Its damage is a workboat's (dents, gouges, a punctured seam, a torn transom), its rot oxidation
  and corrosion, not fibreglass.
- **Riptide** (`../riptide`, 1024): a 3.3 m two-rider jet ski (a deep-V hull, a raised cowl, a stepped saddle, handlebars,
  footwell mats, a reboarding deck over the nozzle). Bold moulded graphics in the craft's colour with black and white,
  the saddle (region 1) stitched, grippy footwell mats, FL 6630 PW on the bow sides, no maker's name.

For each: `python3 paint.py <vessel>`, `python3 wear.py <vessel>` and `python3 wrecks.py <vessel>` make all its
pictures, the scripts taking every vessel of the family by name, and the art check says ok for the vessel and both its
forms. Keep `ref/SOURCES.md` up to date, and report vessel by vessel what you made, what you judged good and what you
would still improve.
