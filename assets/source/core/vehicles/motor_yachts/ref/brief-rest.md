# The rest of the family: the Solstice, the Meridian and the Sovereign

The first vessel of this family is painted end to end: its surfaces (`paint.py`), its hurt and decay layers and wear
stories (`wear.py`) and its two wreck forms' pictures (`wrecks.py`), and each was judged and sent round until it was
right. Now do the same for the Solstice, the Meridian and the Sovereign, to the same bar, with everything those rounds taught. Each vessel and each of its
forms must be checked by you as the first one was before you move on to the next. You may write in `motor_yachts` and in
each vessel's folder and its two forms' folders: `../solstice`, `../solstice_damaged`, `../solstice_sunk`, `../meridian`, `../meridian_damaged`, `../meridian_sunk`, `../sovereign`, `../sovereign_damaged`, `../sovereign_sunk`.

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

- **Solstice** (`../solstice`, one picture `hull`, 2048, cut out for the panes' inner faces): an 11.4 m open day yacht
  with a T-top. Name SUNDOG, MIAMI, FL, and a graphic of its own (not the Belvedere's bird). Its sunk form swamped, not
  burnt.
- **Meridian** (`../meridian`, `hull` 2048 and `house` 2048): a 16.6 m sport coupé with a low raked roof and a split
  panoramic glass roof. Name NIGHT HERON, MIAMI, FL. Its sunk form burnt.
- **Sovereign** (`../sovereign`, `hull` 2048 and `house` 4096): a 32.4 m tri-deck with a plunge pool, a bridge lounge,
  a sun deck and a mast. Name AURELIA, MIAMI, FL. It should make a player want it most of all the fleet. Its sunk form
  burnt.

For each: `python3 paint.py <vessel>`, `python3 wear.py <vessel>` and `python3 wrecks.py <vessel>` make all its
pictures, the scripts taking every vessel of the family by name, and the art check says ok for the vessel and both its
forms. Keep `ref/SOURCES.md` up to date, and report vessel by vessel what you made, what you judged good and what you
would still improve.
