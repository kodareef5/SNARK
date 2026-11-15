# Crown skins: the outside of a broadleaf crown, opaque

You are painting the skin of the broadleaf crowns (live oak, strangler fig and banyan, red mangrove) in a survival game's ruined subtropical city. Work only in the current folder; read anything above it. Take as long as it needs and keep going until you would ship it.

## Why this set exists

The crowns are being rebuilt for a phone's sake. A crown was shells wearing a cut-out leaf atlas with cut-out cards over them, and in a dense wood a phone paid for every layer of cut-out leaf a pixel looked through, up to 30 or 40 of them. Now every head of leaves in a crown is an **opaque** rounded core wearing this skin, so whatever is behind it costs nothing, and only a fringe of cut-out cluster cards stands out round its outline to break it into leaves. Look at `feedback/game_12m_standin.jpg`, `game_25m_standin.jpg` and `game_45m_standin.jpg`: the new construction in the game's renderer, its cores wearing a stand-in skin (the old crown-interior mass, lifted). It reads as camouflage cloth stretched over balls: flat leaf confetti with big dark blotches, no form inside a head, and darker and more olive than the concepts. That stand-in is what you replace.

Then look at the concepts: `../../ref/concept/broadleaf/oak_lineup.png`, `fig_lineup.png`, `banyan_lineup.png`, `mangrove_lineup.png`, `hammock_near.png`, `leaves.png`, and `DESIGN.md` (the sections on foliage and the colour table). Each head of a concept crown is itself made of smaller rounded clumps of leaves: every clump catches the sun on its upper leaves and falls into shade under itself, with narrow dark crevices between clumps. That inner structure, lit by the game's sun, is what the skin must carry, so a head reads as a head of leafy clumps and not as a textured ball.

## How it is used

- A head is a rounded core 2 to 9 m across (masses at the far textured level are larger). The skin is laid flat on each face of the core in pieces up to about 2.4 m across, anywhere in its rectangle, so it must tile left to right and top to bottom, and nothing in it may catch the eye twice.
- The core is lit by a smooth normal that rounds the whole head (lit top, shaded underside, darker deep in the crown), **plus your normal map**. Occlusion multiplies only the sky's light, not the sun's. There are sun shadows on the GPU tiers only. The game's light at 10:00 shows a base colour facing the sun at about its own value (128,132,70 shows as about 137,141,91); facing away, about half.
- It is seen from 5 m (a survivor under the tree) to about 120 m, mostly 15 to 60 m, on a 1080-row screen with a 70 degree view: at 30 m a metre is about 26 pixels. The medium tier stores it at up to 1024 pixels.
- Around the core stand the leaf atlases' own cluster cards (`../oak_leaves/`, `../fig_leaves/`, `../mangrove_leaves/`, cells 0 to 3): the same leaves at the same size must continue from the cards into the skin.

## What to make

Three skins, each a periodic rectangle **2048 by 1024 pixels**, opaque edge to edge:

| skin | across by down | leaves | clumps |
| --- | --- | --- | --- |
| `oak_skin_*` | 4.8 by 2.4 m | live oak, as `../oak_leaves/` cells (blades about 3 to 5 cm in the concept, as that set has them) | rounded shoot clumps about 0.3 to 0.7 m |
| `fig_skin_*` | 6.4 by 3.2 m | strangler fig, as `../fig_leaves/` (blades 10 to 14 cm) | clumps about 0.5 to 1.1 m |
| `mangrove_skin_*` | 4.0 by 2.0 m | red mangrove rosettes, as `../mangrove_leaves/` | rosette clumps about 0.3 to 0.6 m |

Each as four aligned layers: `_base.png` (sRGB 8-bit RGB), `_height.png` (16-bit grey, white high; say the millimetres of its range), `_normal.png` (tangent space, OpenGL convention, green toward the top of the picture, from the delivered height at the physical scale), `_orm.png` (linear 8-bit: occlusion, roughness, metalness 0).

- **Form.** The height field is clumps: each a dome of overlapping leaves, its leaves shingled on it, so the normal map turns each clump's top toward the light and its underside away; crevices between clumps narrow. Relief enough to read at 30 m, about 150 to 250 mm.
- **Colour, unlit.** No light or shadow from a direction is painted in; the light comes from the model and the normal map. Leaves are the species' own pigment, the concept's lit middle tones: for the oak a mix of the atlas's sun and shade leaves with a mean near (112, 120, 64) and the fresher outer leaves toward (160, 156, 80); fig a little darker and greener, mean near (100, 112, 60); mangrove glossier and darker, mean near (88, 108, 58), with a few yellow-green new rosettes. Crevices darker and cooler, but only in narrow lines: no pool larger than a clump, nothing darker than about (40, 52, 38). Pale undersides, brown leaves and fresh tips sparing, as in the atlases: flecks read as noise at distance.
- **Occlusion** 0.6 to 1 (deepest crevices only near 0.6). **Roughness** as the atlases have it (matte; the mangrove a little glossier).
- Build them from the leaf sources you already made for the three atlases (`../oak_leaves/source/`, `../fig_leaves/source/`, `../mangrove_leaves/source/`) and their construction, composing clumps by script at full size. Generate new pictures only if something is missing.

## What excellent looks like

The concept crowns, and the best stylised broadleaf foliage you know of in any game, where a crown's billows are clearly made of lit leafy clumps from 5 m to 100 m. For a complete layer set, the wood plank wall in `../../../../../../../planning/artist-test/wood/` (start with `checks/layers.jpg`), and the palm fronds in `../coconut_frond/` and `../royal_frond/`, which were accepted.

## Checks to leave in `checks/`

A contact sheet of the four layers of each; each tiled two by two and offset by half a period; the base shrunk to what 15, 30 and 60 m draw. The purpose test: each skin laid on a rounded head (a sphere a little flattened, 3 m across for the oak and mangrove, 5 m for the fig, lit by its smooth sphere normal combined with your normal map, sky light times occlusion) under the game's 10:00 light and a 17:00 light (low sun, warm), at the sizes 12, 30 and 60 m would draw it, beside the concept's heads at a similar size. A JSON of your measurements: mean colours, the darkest one percent, occlusion and roughness ranges, normal against height, seam energy at the edges.

## Report

Finish with `REPORT.md`: for each file, how it was made, which checks you ran and what you saw, the millimetres of each height range, and anything you are not satisfied with. Keep `build_skins.py` (rebuilds every layer), `check_skins.py` and any sources here so the set rebuilds.

Do not use or imitate pictures from any existing game, and do not search for or download reference images. The concept pictures in this repository are ours: use them freely.
