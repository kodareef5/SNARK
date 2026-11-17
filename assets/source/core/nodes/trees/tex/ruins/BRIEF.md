# Ruins: what the figs have swallowed

You are painting the pieces of the old city that the great figs of a survival game's ruined subtropical city have grown round and lifted: a portico column, a concrete utility pole, a street sign on its post, and a small car. They show through windows in a strangler fig's root wall at a player's eye height, and the car hangs 3 m up between a banyan's pillars, so they are seen from a few metres off. Work only in the current folder. Take as long as it needs and keep going until you would ship it.

## What it looks like

The design is set. Open `../../ref/concept/broadleaf/`: `fig_trunk.png` (the column inside the roots), `fig_lineup.png` (the pole fig, the portico fig, the sign fig), `banyan_lineup.png` (the car), `hammock_near.png`, and `DESIGN.md` (the fig and banyan sections, and the colour table: swallowed concrete `#A49E8C`, old exposed faces `#CCC0A2`, damaged recesses `#666A5D`; rusted steel and sign `#8C4F2E`, flaking rust `#B5743F`, surviving dark metal `#454A43`). Everything is decades old: concrete chipped to its rebar, stained by rain and roots, patched with lichen and green damp; steel rusted through, paint faded to ghosts of colour. No legible writing, no logos, no brand.

## The layout and how it is used

One picture, five regions (`guide/layout.png` and `guide/LAYOUT.json` give the pixels). Nothing repeats: each region is laid on its piece once.

- **column** (the left quarter, 512 by 2048): one face of a square portico column 0.45 m wide and 4.5 m tall, its top row at the column's top. The top 0.6 m (the box marked in the guide) is the face of its capital: a moulded block, broken at one corner. Below it the shaft: smooth cast stone or plastered concrete, chipped at its arrises, rust stains bleeding from exposed rebar, dark damp toward the foot. All four faces of the column wear this, so do not put one unmistakable mark in it that would show four times.
- **pole** (the second quarter): a round concrete utility pole 0.3 m across and 6 m tall, once round it across the region, top row at its top, so left and right edges meet: spun concrete, hairline cracks, a band of rust round an old bolt hole or two, a broken iron step, lichen.
- **post** (the narrow fifth region): a rusted steel pipe 8 cm across and 3.5 m tall, once round it, top at the top, edges meeting: pitted rust, flaking, a band of old galvanising.
- **sign** (top right): the blade of a street sign 0.75 m by 0.45 m: its front on the left half of the region, its back on the right. A dented, rusted metal plate, its faded paint now a ghost of a colour band and an arrow, no letters; the back plain rusted steel with two bolt holes.
- **car** (bottom right, 768 by 1280): the body of a small rusted car, laid round it: across the region from the middle of its underside, up its right side, over its roof and down its left side back to the middle of the underside, so left and right edges meet; down the region from its front bumper (top row) to its rear (bottom row). The guide marks where its side windows fall (blue: paint them as empty, dark window openings with a few teeth of broken glass at their edges) and its wheels (red: dark arches, perished tyres). Rust in sheets and blooms, a ghost of faded paint, dents, a crushed roof line, roots' scars.

## Deliver, all 2048 by 2048 and pixel-aligned

1. `ruins_base.png`: base colour, sRGB, 8-bit RGB. Flat and unlit.
2. `ruins_height.png`: 16-bit greyscale, white high. Say how many millimetres the full range is.
3. `ruins_normal.png`: tangent-space normal map, **OpenGL convention** (green toward the top of the picture), computed from the delivered height at the physical scale of each region.
4. `ruins_orm.png`: linear 8-bit RGB: red ambient occlusion, green roughness (concrete about 0.85, rust 0.7 to 0.9, the dark surviving metal 0.5), blue metalness (bare surviving steel up to 0.6; rust and paint 0).

Keep the generated source pictures at full size in `source/`, and the scripts that build every layer (`build_material.py`) and check them (`check_material.py`) in this folder, so the whole set rebuilds.

## What excellent looks like

The bar is the concept pictures, and the bar for a complete layer set is the wood plank wall in `../../../../../../../planning/art-trial/wood/` (start with `checks/layers.jpg`). Pieces of a city that a player recognises at once as what they were, and that look as old as the trees round them. The image tool returns about 1254 pixels a side; reach 2048 by composing generated pictures in a larger master laid out on the guide and by adding fine detail by script.

## Checks to leave in `checks/`

A contact sheet of the four layers; the base colour over the layout; the pole, post and car regions tiled twice across to show their left and right edges meet; and a JSON of your measurements (how hard each wrapping region jumps across its edges against inside it, normal against height agreement).

## Report

Finish with `REPORT.md`: for each file, how it was made, which checks you ran and what you saw, the millimetres of the height range, and anything you are not satisfied with.

Do not use or imitate pictures from any existing game, and do not search for or download reference images. The concept pictures in this repository are ours: use them freely.
