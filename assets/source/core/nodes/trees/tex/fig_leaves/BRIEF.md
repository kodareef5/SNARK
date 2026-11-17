# Fig leaves, second set: the picture a fig's or a banyan's crown is built from

You are painting the foliage of the strangler fig and the banyan, the great figs of a survival game's ruined subtropical city. Work only in the current folder. Take as long as it needs and keep going until you would ship it.

A first set was made here and the crowns built from it failed (`../../ref/renders/lineup_fig.jpg`, `game_near_fig_2.jpg`, `lineup_banyan.jpg` beside `../../ref/concept/broadleaf/fig_lineup.png` and `banyan_lineup.png`): sparse torn plates with white flecks, no mass. The model is being rebuilt on a new crown system, which the live oak already uses; its leaf atlas, `../oak_leaves/`, is the nearest example of what this set must be (read its `BRIEF.md`, `BRIEF_ROUND2.md`, `BRIEF_ROUND3.md` and `REPORT.md`: three rounds of what worked on the crowns in the game and what did not). This set replaces the first, in a new layout.

## What it looks like

Open `../../ref/concept/broadleaf/fig_lineup.png`, `fig_trunk.png`, `banyan_lineup.png`, `banyan_hall.png`, `hammock_near.png`, `leaves.png` (the fig twig, the aerial-root tuft) and `DESIGN.md` (the fig and banyan sections and the colour table). The fig's crown is broad dark domes of overlapping clumps, heavier and smoother than the oak's, with sky channels between the domes; the leaves are leathery smooth ovals with a short point, 10 to 14 cm long, set in rosettes at the stout twig ends, dark green above and paler beneath.

## How the picture is used

A crown is about fifteen lobes, each a few rounded billows. Every billow is a closed low-polygon shell wearing **the mass**, with **cluster** cards lying on its top, standing out round its rim and hanging under it. Shell and cards are lit by normals that round the whole billow, so the crown's light and shade come from the model; under the billows the shell's lower faces also wear the rim clusters, cut out, so from beneath there is sky between clumps. Seen from 5 m the clusters and the mass between them are what a player sees; from 30 to 60 m they merge into domes; from 200 m the crown is drawn in flat colours without this picture.

The layout is `guide/layout.png`, with its numbers in `guide/LAYOUT.json`:

- **Cells 0 to 3** (the top left quarter, 512 pixels each, **1.2 m across**): each a cluster of leafy twig ends seen from above, a short pale twig entering at the middle of the cell's bottom edge. Cells 0 and 2 lie on the tops of the billows: (0) a full rounded clump of four to six rosettes; (2) the same with fresh yellow-green leaves unfolding at a few tips and one or two yellowed old leaves. Cells 1 and 3 stand round the billows' rims and hang beneath them, seen from the side and below as often as above: (1) a broader, lop-sided clump of two or three groups; (3) a longer spray, its leaves more turned, some showing their paler undersides. Dense, a little gap here and there, leaf tips making every outline.
- **Strip 1** (512 by 1024 pixels at the top right, **1 m wide, 2 m long**): a dense curtain of fig aerial roots hanging from the top edge where they leave a limb: eight to fourteen uneven roots 0.5 to 2 cm thick at the top, tapering to fine free ends at different lengths, a few twisting round one another, thinner side roots, grey-brown (`#887C65`, `#B0A28A` dry, `#5C5E4D` old). **Strip 2** (the next 512 by 1024, the same size): a sparse curtain of four to six such roots, longer and finer. Both must still read as roots at 15 m, so give the main strands body; air between them.
- **The mass** (the bottom half, 2048 by 1024, **6.4 m across and 3.2 m down**): the outside of a full crown, leaves over leaves, no sky and no transparent pixel, tiling left to right and top to bottom with nothing the eye catches twice.

## What the oak's rounds taught

- **Paint the leaves larger than botany** so they read on a crown: about 14 to 20 cm long here, so a leaf shows from 10 m and a rosette from 30 m.
- **Rosettes over rosettes, overlapping like shingles**, sizes varied, at different depths. Never a tiling of discs, never a line drawn round a rosette or a clump (the oak's second round read as cobblestones from that).
- **Shade is pooled, not drawn**: where the eye looks down between groups of rosettes, an irregular darker hollow of deeper leaves, darker in base colour and in occlusion, the deeper the darker and bluer.
- **Each leaf tilted** 20 to 50 degrees its own way, and that tilt in the height (let its range be 120 to 200 mm), so under the game's sun the leaves facing it light up and the rest go dark.
- **The clusters and the mass are the same leaves in the same light**, so a card shows as a ragged edge and a little relief, not a spot of another tone.

## Colour and light

In this game a leaf lit head on by the sun shows its base colour, one facing away about half of it, with nothing bounced and no cast shadows. Paint the concept's sunlit middle tones, unlit. For the fig: the clusters' mean near **(84, 100, 58)**, a deeper, greener olive than the oak's; fresh tips toward (140, 150, 70); the mass near **(70, 84, 48)**, darker only in its hollows. Undersides as an occasional turned leaf, no lighter than about (115, 125, 90). The leaves are **matte** in this light: roughness **0.93 to 0.97** (roots 0.9); occlusion 0.75 to 1 on the clusters, down to 0.45 in the mass's hollows.

## Deliver, all 2048 by 2048 and pixel-aligned

1. `fig_leaves_base.png`: base colour, sRGB, 8-bit **RGBA**. Alpha cut at one half in the game, soft over one to two pixels round every leaf and root; colour continued under transparent parts to each cell's edge; nothing within 12 pixels of a cell's or strip's edge but the twig and the roots' tops. The mass is opaque edge to edge.
2. `fig_leaves_height.png`: 16-bit greyscale, white high. Say how many millimetres the full range is.
3. `fig_leaves_normal.png`: tangent-space, **OpenGL convention** (green toward the top of the picture), computed from the delivered height at the physical scale.
4. `fig_leaves_orm.png`: linear 8-bit RGB: occlusion, roughness, metalness 0.

Keep the generated source pictures you build from at full size in `source/`, and the scripts that build every layer (`build_material.py`) and check them (`check_material.py`) here, so the set rebuilds. When yours is done, remove the first set's scripts, checks, sources and report, keeping anything of it you reused.

## What excellent looks like

The bar is the concept paintings; for a complete layer set the wood plank wall in `../../../../../../../planning/art-trial/wood/` (start with `checks/layers.jpg`) and the palm frond sets in `../coconut_frond/` and `../royal_frond/`, which were accepted. The best broadleaf foliage you know of in any game. The image tool returns about 1254 pixels a side; reach 2048 by composing generated pictures in a larger master and adding detail by script.

## Checks to leave in `checks/`

A contact sheet of the four layers; the base over the layout; the alpha alone; the clusters shrunk to a half, a quarter, an eighth and a sixteenth over mid-grey and over a pale sky, cut at one half; the mass tiled two by two; the layers lit by the normal map from two sides. Then the purpose: clusters over a shell of the mass, as on a billow, at the size a 30 m view would draw it, under the sun behind the viewer and high behind the billow, beside a crop of `fig_lineup.png` at the same scale. A JSON of your measurements: alpha in the margins (none), each cluster's coverage of its outline at each shrink, the mass all opaque, mean colours, roughness and occlusion ranges, normal against height.

## Report

Finish with `REPORT.md`: for each file, how it was made, which checks you ran and what you saw, the millimetres of the height range, and anything you are not satisfied with.

Do not use or imitate pictures from any existing game, and do not search for or download reference images. The concept pictures in this repository are ours: use them freely.
