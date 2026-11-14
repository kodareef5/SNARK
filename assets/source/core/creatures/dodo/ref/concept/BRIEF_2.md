You are painting the second and final round of a game creature's concept design. Work only in the current folder.

## Where this stands

Round 1 is in this folder: your brief (`BRIEF_1.md`), your report, scripts and sources, and the delivered pictures, copied to `round1/`. The character is right and stays: the vacant, heavy-lidded, mildly grumpy face, the ochre brow shelf, the pebbled rose face, the ringed olive-horn beak, the slate body with pale back bars, the barred tail curl, the stout ochre legs, the painterly but precise surface. The silhouette reads as a dodo even 16 pixels tall. Keep the hand, the palette and the quality of round 1.

What round 1 lacked, as your own report says, is one common shape behind the four views. That now exists. `guides/` holds renders of the 3D block-out the modeller will build from and the animators already animate:

- `blockout_side.png`, `blockout_front.png`, `blockout_back.png`, `blockout_top.png`: the four orthographic views on exactly your canvas (1254 x 1254, 1500 px a metre, ground row 1150, side foot centre column 640, front/back/top centre column 627, top foot centre row 690), coloured by region (slate body, umber hood, rose face, olive beak, ochre brow, throat and legs, cream wing fingers);
- `blockout_<view>_mask.png`: their silhouettes;
- `blockout_three_quarter.png`: the same block-out from the front left, in perspective.

The block-out was fitted to your round 1 silhouettes (they overlap by 0.92 to 0.94), and it carries this round's changes to the beak and the mane. It is made of smooth simple masses, so it is the geometry, not the look: no feathers, no texture, no outline breakup. Paint your bird onto it.

## What to change

1. **The beak must dominate the head in every view.** It is the creature's first recognition trait: oversized, deep and heavy. Follow the guide's beak: the ridge along the top arcs higher toward the tip, and the hook is fuller and heavier, curling down well past the end of the lower beak, its tip about 2 cm below the lower beak's tip line. Your round 1 `head_side.png` beak has the right weight; the full-body side view's beak was too slender. Keep the three ring grooves, the low nostril slit, the down-turned mouth corner, the paler worn hook.
2. **The hood is a hood, not a wig.** Short, dense, velvety feathers lying close over the crown and the back of the skull, so the head's shape shows through. A ragged edge of small tufts around the bare face, and the blunt point on the forehead between the brows. The nape mane is shorter and slimmer than in round 1: a lank fringe of longer loose feathers lying down the back of the neck to about its middle (about 0.47 m above the ground in the side view, as in the guide), no wider than the neck. Same umber colour.
3. **The wing fingers are feathers.** In round 1 they read as pale claws or tusks. Make them four broad, flat, soft flight feathers, each with a visible shaft and a vane, blunt rounded tips, a little ragged, fanning slightly out of the back edge of the folded wing. Cream. Nothing pointed, nothing curved like a claw.
4. **The tail curl is feathers.** In round 1 it reads as a striped furry tail. Make it six to eight distinct broad soft tail feathers, each with a shaft and vane, curling up and forward in a loose curl, the same size and place as in the guide. The barring runs across each feather as narrow cream bands, so the bars are on the feathers, not rings around a tube.
5. **Body feathers: rounder and softer.** Keep the overlapping rows, but give the feathers rounder, softer tips and a little less regularity, so the body reads as plumage and not as a pinecone or scales. Keep the shaggier flanks, the loose trousers over the thighs and the ragged lower edge of the belly.
6. **Back bars made of feathers.** Keep the pale chevron bars across back, rump and tail, but make each bar the pale tip band of a row of feathers, so a bar is made of feather edges: narrower, slightly broken, following the rows. Fading down the flanks. Breast and belly plain.
7. **The throat pouch is shorter.** The pleated ochre skin runs from the chin to about two thirds of the way down the front of the neck, not as a long bib to the chest.

Everything else as in `BRIEF_1.md`: the proportions, the colouring, the canvas, the plain background, flat neutral light, no text, symmetric, no added parts.

## What must hold

- **Every orthographic view is painted onto its guide.** The bird's silhouette follows the guide's silhouette, except where feathers break the outline into a soft, ragged edge, which they should: within about 10 pixels everywhere else. The beak, eye, brow, hood edge, wing, tail and toes sit where the guide puts them. Measure it: the overlap of each painted mask with its guide mask (intersection over union), and the largest distance between the two outlines away from feather fringes. Report both.
- **The views agree with one another** as in round 1 (landmark rows within 2% of the height, widths and lengths within 3%), and now also in detail: the same number of tail feathers, wing fingers and back bars wherever they show, in the same places.
- The three-quarter view and the head close-ups show the same bird: redo them with the changes.

## What to deliver

The same files as round 1, replacing them in this folder: `side.png`, `front.png`, `back.png`, `top.png`, their `*_mask.png`, `three_quarter.png`, `head_side.png`, `head_front.png`, the four `regions_*.png` (same pure colours and rules as round 1), `variants.png`, `read_sizes.png`, `checks/` with this round's measurements, and `REPORT.md` with a section for this round: what changed, how each picture was made, the overlap with the guides, how long it took, and what you are not satisfied with. Keep `round1/` and `guides/` as they are. Keep every script in this folder so the work can be rebuilt.

## What excellent looks like

The same studio-wall concept as round 1, now one bird seen four ways. A modeller can trace any view and get the same creature; a texture painter can follow one feather layout and one set of markings around it. In every view and at every size the heavy hooked beak is the first thing you see, the dim eye under the brow the second. Someone who knows game dodos recognises it at once, and on a second look sees its own bird: the ringed beak, the pebbled rose face, the close umber hood with its lank mane, the feathered pale wing fingers, the barred tail curl.

Look at every picture you make, compare the views with one another and with the guides, and keep going until you would stand behind them.
