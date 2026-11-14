# Dodo: our design

The design every dodo task builds to. The modeller (D2) builds from the orthographic views, the animators (D3a, D3b, D3c) work on the skeleton in [`../rig.py`](../rig.py), the texture maker (D4) paints from the colours, markings and regions below, and the content author (D5) takes the numbers from [`../asset.ts`](../asset.ts). It keeps what [TRAITS.md](TRAITS.md) says carries recognition and changes what it says is most likely to read as copied.

| Picture | What it is for |
|---|---|
| [concept/side.png](concept/side.png), [front.png](concept/front.png), [back.png](concept/back.png), [top.png](concept/top.png) | The four orthographic views, one bird. 1254 pixels square, 1500 pixels a metre, ground at row 1150. Model from these |
| [concept/three_quarter.png](concept/three_quarter.png) | The character |
| [concept/head_side.png](concept/head_side.png), [head_front.png](concept/head_front.png) | The head's detail: beak, face, eye, brow, hood edge, throat |
| [regions/side.png](regions/side.png), [front.png](regions/front.png), [back.png](regions/back.png), [top.png](regions/top.png) | Where the six colour regions lie, in the region map's own colours |
| [concept/variants.png](concept/variants.png) | Six colourings in the spirit of the colour set (painted before the set was fitted to the palette) |
| [concept/read_sizes.png](concept/read_sizes.png) | The bird 128, 48 and 16 pixels tall |
| [blockout_vs_concept.png](blockout_vs_concept.png) | The block-out in `rig.py` over the four views |
| [blockout_poses.png](blockout_poses.png) | The block-out posed on its skeleton |

## The design in words

A fat, slate-grey ground bird, 0.65 m tall, as round as a sack, standing on two short ochre legs. Its body is an egg 0.44 m long and 0.30 m tall, widest behind the legs, with a full breast that runs straight up into a thick neck at the front. The head rides above the breast and is mostly beak.

**The beak** is olive horn, deep and heavy and laterally flattened, 0.12 m long. A ridge runs along its top and arcs down into a full, heavy hook that overhangs the lower beak by about 2 cm, paler where it is worn. Three shallow grooves ring the upper beak near the face. The nostril is a long narrow slit low on the side, a third of the way along. The line of the mouth curves down at the back into a fleshy corner, so the bird always looks faintly put out.

**The face** is bare, pebbled rose skin with a few soft folds under the eye and at the mouth corner. Above the eye a heavy, smooth ochre brow juts out like a shelf. Under it sits a small straw-yellow eye with a black pupil and a half-closed upper lid: a vacant, sleepy, mildly grumpy stare.

**The hood** is a plush cap of short, dense, soft umber feathers lying close over the crown and the back of the skull, small and irregular, so the skull's shape shows through. It comes down to a blunt point on the forehead between the brows and ends around the face in a ragged edge of small tufts. Behind, it lengthens into a lank mane of longer loose feathers lying down the back of the neck to about its middle. Under the chin a pouch of bare, pleated ochre skin lies flat on the front of the neck and runs two thirds of the way down it; nothing hangs from the chin.

**The plumage** is rounded, soft feathers in loose overlapping rows: neat on breast and back, longer and shaggier on the flanks, where they hang as loose trousers over the thighs to the top of the scaly legs. The outline is soft and ragged everywhere. Five rows of narrow cream bars, each the pale tips of a row of feathers, cross the back and rump in chevrons and fade down the flanks; breast and belly are plain.

**The wing** is a small rounded stub folded on the middle of the flank, covered in body feathers, with four broad cream flight feathers fanning out of its back edge like fingers. **The tail** is a raised tuft of seven broad, soft feathers, a central one and three pairs, rising from the top of the rump and curling forward over the back, each crossed by two narrow cream bands at its tip. **The legs** are stout, with large plates down the front and small pebbly scales behind; three thick toes forward and one behind, with long dark horn claws.

## What is deliberately different from ARK's dodo

These are the choices that make it ours. Everything in "what it keeps" below stays.

1. **No plumes.** No thin spot-tipped feathers anywhere. The nape has a lank umber mane instead.
2. **No pale or lavender tail plume.** The tail is a forward-curling tuft of seven body-coloured feathers, banded at the tips like the back.
3. **The beak's detail.** Three ring grooves at the base, a low slit nostril, a ridged top and a heavier, more pointed hook, all in one tone with a worn pale hook. Not a dark tip on a pale base.
4. **The face and brow.** Pebbled rose skin, not wrinkled tan or yellow; a smooth, heavy ochre brow shelf in a second colour; a pale straw eye.
5. **The hood's shape.** A close, plush cap of small feathers with a blunt forehead point between the brows and a lank mane of longer feathers down the nape.
6. **The throat.** A pleated bare pouch in the brow's colour, lying flat down the front of the neck.
7. **The markings.** Narrow pale chevron bars across back, rump and tail, made of feather tips. No mottling, no wing blotch.
8. **The wing.** Four pale feathered fingers at the back of the wing take the place of a pale patch.
9. **The feathers.** Rounded, soft and loose, shaggy at the flanks, in place of tight scale-like rows.
10. **The colour set.** Our own natural tones per region from the palette (below), with a slate bird, an umber hood and a rose face as the default.

## What it keeps

The traits that make it read as the game's dodo at a glance, from [TRAITS.md](TRAITS.md):

- the oversized, deep, hooked beak that dominates the head;
- the bare face set into a feathered hood;
- the pear or egg body, the thick neck rising at the front, the big head held high above the chest, short stout legs, stubby folded wings, a tuft of tail at the top of the rump;
- the small dim eye high at the back of the face, under a heavy brow;
- overlapping feather rows that read up close;
- the six colour regions in the game's layout, so the head is the most colourful part.

## The six colour regions and the two materials

The game's six regions, in its order. They are painted in each material's region map (D4's), in the build's colours: red, green, blue, cyan, magenta and yellow for regions 0 to 5, and black where nothing is dyed. [regions/side.png](regions/side.png) and its three siblings draw them on the concept views in exactly those colours. (The concept folder's own `regions_*.png` use the colour order of the briefs: red, yellow, green, cyan, blue, magenta. Paint from `regions/`.)

| Region | Name | Map colour | Where it lies |
|---|---|---|---|
| 0 | Body | red | Every contour feather of body and neck, from the hood's lower edge and the throat pouch's edges down: breast, back, flanks, belly, the thigh trousers, the under-tail, the folded wing's covering feathers, and the tail feathers between their bands. The main colour |
| 1 | Face | green | The bare skin of the face: from the base of the beak back around the eye to the hood's ragged edge, and down to the corner of the mouth. Includes the eyelids. Excludes the brow above and the throat pouch below |
| 2 | Beak | blue | Both halves of the beak, from where they meet the face to the hook |
| 3 | Forehead, Neck and Feet | cyan | The brow shelf over each eye, from the beak's base back over the eye; the pleated throat pouch, from the chin two thirds of the way down the front of the neck; the scaly legs below the trousers and the toes, without the claws |
| 4 | Head | magenta | The hood: crown, forehead point, back of the head, the ragged edge around the face, and the nape mane down the back of the neck |
| 5 | Wings and Patterning | yellow | The four flight-feather fingers of each wing, and the pale tip bands that make the bars across back and rump and the two bands at the tip of each tail feather |

**Never dyed (black in the map):** the eye (straw iris, black pupil), the claws (dark horn), the inside of the mouth and the tongue (dull pink-grey; seen only when the beak opens). The base colour paints them in their own colours. Everywhere else the base colour is light grey and carries only light and dark: the beak's grooves and worn hook, the face's folds and pebbling, the brow's smoothness, the pouch's pleats, the feather rows, the leg plates. The region's dye gives the hue.

**Two materials**, named in Blender as `asset.ts` names them (`rig.py`: `MATERIALS`):

| Material | Drawn | Pictures | Parts |
|---|---|---|---|
| `dodo` | opaque, one-sided | 2,048 base and normal; packed map and region masks stored at 1,024 | The closed surface of the bird: body, neck, wing and hood feathers painted on it; bare face, brow and throat pouch; both halves of the beak; inside of the mouth and the tongue; eyes and lids; legs, toes and claws |
| `dodo_cards` | cutout, two-sided | 512 base (its alpha is the cutout) and normal; packed and masks at 256 | Feather cards that break the outline: the hood's ragged edge and forehead point, the nape mane, the four flight feathers of each wing, the seven tail feathers, the trousers and the belly's lower edge, loose feather tips along back, breast and flanks |

The design is symmetric, so a mirrored half is fine on both. In the largest variant (rgba) the two take 27.0 MB of the 28 allowed; in bc and astc, 15.6 MB.

`rig.py` also makes one material per region (`REGION_MATERIALS`: `body`, `face`, `beak`, `forehead_neck_feet`, `head`, `wings_patterning`). Only the block-out wears them, so it can be built and looked at before the pictures exist; the build does not read them once `materials` is given.

## Suggested colour set

A region's colour is a palette entry (`shared/pack/palette.ts`), so the set is given as entries, each against the tone the concept meant. ΔE is the CIE76 distance between the two: under about 5 reads as the same colour, over 10 as a different shade. All are natural tones from the palette's rings except 239 and 234, the survivor colours called amber and brown (an eye colour). Each region rolls on its own, so most combinations must look like a plausible bird: keep the face pale and warm in most draws and the beak a mid or dark tone. The default bird is the first entry of each row (`rig.py`: `REGION_DEFAULT`; `asset.ts`: each region's `sample`). No lavender or violet anywhere, to stay clear of the game's tail plume.

| Region | Entry, palette colour (meant tone), ΔE |
|---|---|
| 0 Body | **87 slate** #6B737A (#6B737A) 0.0; 86 dark slate #5B6369 (#5D6266) 1.7; 100 ash #908A80 2.6; 117 peat brown #54412E 3.0; 122 dun #AB906A 7.5; 179 russet #874833 4.1; 129 olive drab #6D6F4A 2.3; 95 sooty #403B37 2.1; 123 sand #BBA27B 6.3; 104 cream #D4CFC4 7.8 (rare) |
| 1 Face | **113 rose buff** #D1A292 (#DDA58E) 5.9; 114 flesh pink #E3B4A2 3.1; 177 pale straw #E2B881 6.8; 105 ivory #E6E2D6 6.6; 161 pale olive #C1C685 8.3; 101 dusky taupe #A09A90 9.3 (rare) |
| 2 Beak | **131 olive horn** #8B9166 (#8F8A5E) 5.2; 123 pale horn #BBA27B 4.4; 86 slate #5B6369 1.7; 83 charcoal #313639 2.7; 117 umber #54412E 3.3; 148 moss #5D6A39 0.4; 178 oxblood #723B2B 7.8 (rare) |
| 3 Forehead, Neck and Feet | **212 ochre** #C29533 (#C4983C) 2.9; 239 amber #AA7C30 12.2; 192 mustard #BBA549 3.4; 206 dull orange #CE7E43 3.2; 157 olive #847E3F 5.2; 87 slate #6B737A 3.3; 111 dull pink #AE7F73 3.9 |
| 4 Head | **94 umber-charcoal** #312D2A (#3B302A) 4.6; 82 sooty #24282A 4.2; 234 chestnut #684226 5.8; 117 peat brown #54412E 3.0; 85 slate #4D5358 1.1; 100 ash #908A80 2.6; 105 white #E6E2D6 2.1 (rare) |
| 5 Wings and Patterning | **105 cream** #E6E2D6 (#E6DCC4) 7.0; 125 pale buff #DDC69C 1.2; 104 ash white #D4CFC4 3.0; 180 rust #9D553A 4.9; 133 pale olive #AAB489 5.5; 91 pale blue-grey #AEB6BF 2.4; 94 sooty #312D2A 1.2 |

**How near the palette comes.** The palette's natural tones were fitted again in round 7 with this set among their targets (`tests/fixtures/palette-targets.ts`), and each entry above is its tone's nearest in it; where two tones of a region met on one entry, the second took its next nearest. The ochre, mustard, dull orange and rust now land 3 to 5 away and the moss 0.4, where they were 9 to 12. The furthest are the dusky taupe (9.3), the pale olive face (8.3), the oxblood (7.8), the dun (7.5) and the creams and ivory (6.6 to 7.8), which read a little greyer than the concept.

## How it reads near, far and tiny

- **Close (a few metres):** the ring grooves and hook of the beak, the pebbled face, the half-lidded straw eye under the ochre brow, the hood's ragged edge and lank mane, the pleated throat, the feather rows and their pale tips, the feathered wing fingers, the barred tail curl, the leg plates and claws.
- **Middle (10 to 30 m):** a round slate body, a thick neck rising at the front, and a big head with a dark cap, a pale face and a heavy olive beak. The back bars and the pale wing fingers read as a light patch at the back. The legs almost vanish.
- **Far, or 16 pixels tall:** a ball on a short thick stalk with a hooked lump on top, a bump at the back for the tail, two short legs. The head is the darkest and the most colourful part. [concept/read_sizes.png](concept/read_sizes.png) shows the black silhouette still reads as a dodo at 16 pixels.
- **The triangle bird** (level 6, 48 triangles) keeps the round body, the neck at the front, the oversized forward head with a hooked beak, and the two legs. Wings, tail feathers and toes go first; the tail can stay as a single bump.

## Size and proportions

The chosen numbers, measured from the concept views and kept in `rig.py`. Ratios are against [TRAITS.md](TRAITS.md)'s ranges.

| Part | Ours | Range in TRAITS.md |
|---|---|---|
| Standing height, ground to the top of the hood | 0.65 m | 0.5 to 0.75 m |
| Body length and height | 0.44 m and 0.30 m, ratio 1.47 | 1.3 to 1.6 |
| Body tilt | a level egg with a vertical breast; the chest reads raised from the breast running up into the neck | 15 to 35 degrees |
| Head with beak | 0.25 m, 0.57 of body length | 1/2 to 2/3 |
| Head height | 0.13 m, 0.20 of standing height | 1/5 to 1/4 |
| Beak | 0.12 m, about 0.48 of head length; 0.08 m deep at the base, 0.07 m near the hook | 2/5 to 1/2; depth 1/2 to 2/3 of skull |
| Eye | 0.022 m, 0.58 m above the ground | about 1/10 of head length |
| Neck | 0.14 m visible, 0.15 m deep at the base, 0.09 m across | 1/4 to 1/2 of body length; about 1/2 of body height |
| Top of the head above the back | 0.25 m, 0.83 body heights | 0.6 to 1.0 |
| Legs below the feathers | 0.10 m, 1/6.5 of standing height | 1/7 to 1/4 |
| Feet | 0.155 m from front toe tips to hind toe; 0.11 m apart | about 1/3 of body length |
| Folded wing | 0.18 m with its fingers | 1/3 to 1/2 of body length |
| Tail curl | 0.11 m | 1/4 to 2/5 of body length |

## For the makers

- **Modeller.** Build on `rig.py`'s skeleton: `model.py` runs after it, calls `rig.find()`, drops the block-out with `r.drop_blockout()`, and binds its mesh with `r.bind(mesh)`. One finest level only, in the two materials `dodo` and `dodo_cards`, with texture coordinates, smooth normals and up to four bone weights a vertex; the build makes the other levels to `asset.ts`'s budgets. Model in the rest pose the skeleton has: standing, wings folded, beak closed, upper lids half closed. The upper lid of each eye is a shell over the eyeball hinged on `lid_l` or `lid_r` at the eye's centre, so a 42-degree turn shuts it. Model the inside of the mouth and a tongue, since `call` and `startled` open the beak 38 degrees. The jaw hinges at the mouth corner (`jaw`); the throat pouch follows `throat`; the nape mane follows `hood`. Then run `--check` and move `flat` to the first level drawn under about 48 pixels.
- **Texture maker.** The pictures `asset.ts` names, all square, none under 64 pixels. The base colour is unlit, and light grey under every dyed region, so the grooves of the beak, the hook's wear, the face's folds, the bars and the leg plates live in it as value, not hue. The region maps use the build's colours ([regions/](regions/)). The bars are region 5 and lie on the feather tips; the throat pouch is region 3, not region 1.
- **Animators.** `rig.py`'s docstring and `CLIPS` table say who makes which clip, how long it may be and what `r.finish()` checks. The rest pose is the stance every clip starts and ends on.

## How it was made

Four rounds of the image model, one brief each, all in [concept/](concept/):

1. [BRIEF_1.md](concept/BRIEF_1.md) set the design in words. It gave the character, but a slender beak, a hood like a wig, wing fingers like claws, a furry tail and pinecone feathers, and the views did not come from one shape.
2. The block-out in `rig.py` was fitted to round 1's silhouettes and given a heavier hook and a slimmer mane. Its renders ([concept/guides/](concept/guides/)) became the shared geometry [BRIEF_2.md](concept/BRIEF_2.md) had every view painted onto. The beak, wings, tail, bars and plumage came right; the hood turned into a smooth helmet and the throat into a ball, the second copied from the block-out's own round throat.
3. With the block-out's throat laid flat on the neck, [BRIEF_3.md](concept/BRIEF_3.md) redid the head: the throat, brow and face came right; the hood became rows of tiny scales.
4. [BRIEF_4.md](concept/BRIEF_4.md) redid the hood alone, as a plush cap of small soft feathers with a ragged edge, a forehead point and a mane of lengthening feathers. This round is the design.

The final views lie on the block-out's renders with an overlap of 0.94 to 0.95, and agree with one another within 2% of the height in every landmark and 3% in every width and length ([concept/REPORT.md](concept/REPORT.md)). Only the accepted round is kept, with what it is built from. Round 4 painted the hood into round 3's pictures, so those (`concept/round3/`) stay as its base, with round 3's head masters and protected masks (`concept/sources/round3/`). The image model's round 4 paintings are in `concept/sources/round4/`, and `concept/rebuild_round4.sh` makes every picture at the top of `concept/` again from them, byte for byte. Every brief stays, with artist's last message of each round (`artist_<round>.last.txt`) and its reports in `concept/REPORT.md`, newest first. The superseded rounds' pictures and the transcripts are not kept; neither are the measurements and overlays the scripts write (`concept/checks/`).

[blockout/compare.py](blockout/compare.py) measures the block-out against the views, and [blockout/preview.py](blockout/preview.py) renders it.
