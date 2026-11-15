You are painting the second round of a game creature's concept design, the pteranodon. Work only in the current folder.

## Where this stands

Round 1 is in this folder: your brief (`BRIEF_1.md`), your report (`REPORT.md`), scripts, prompts and originals, and the delivered pictures, now moved to `round1/`. The character is right and stays: the lean coastal flyer with its ivory velvet fuzz, the continuous orange horn cap over beak, skull and crest, the single sabre crest with its one charcoal band near the tip, the charcoal eye streak, nape line, mantle and wingtips, the slate membrane with its warm wash by the body, the grasping orange feet, and the saddle of stitched hide, bent wood faced with chitin, rope-wrapped loop grips and pegs on plaited rope. The head seen from the front (`round1/head_front.png`) and the spread plan views are excellent. Keep the hand, the palette and the quality of round 1, and the realistic matte finish of the attached example.

What round 1 lacked, as your report says, is one common shape behind the views, and a few points of the design. The shape now exists. `blockout_guides/` holds renders of the 3D block-out the modeller builds on and the animators already animate, on exactly your canvases (400 px a metre; the same columns and rows as round 1):

- `guide_top.png`, `guide_underside.png`, `guide_front.png` (3200 x 1600) and `guide_side.png`, `guide_folded_side.png`, `guide_folded_front.png` (1600 x 1600), each with its `_mask.png`. The spread views are the animal at rest in a glide; the folded views are it standing on the ground.
- `guide_saddled_side.png`, `guide_saddled_folded_side.png`, `guide_saddled_top.png`, with masks: the same with the saddle's block-out and a jointed mannequin for the rider, built from the game's human proportions and seated as the game will seat the player.
- `guide_three_quarter.png` (in flight, from below and in front of its left side, banking), `guide_saddled_three_quarter.png` (from above and behind its left shoulder, ridden), `guide_saddle_detail.png` (the saddle on the standing animal, from above and behind).

They are coloured roughly by region (ivory body, charcoal marks, orange horn, slate membrane, warm wash, brown saddle and mannequin). They are geometry, not the look: smooth simple masses, no fuzz, no skin, no detail. The block-out was fitted to your round 1 silhouettes: from above and below it overlaps them by 0.95, from the side by 0.70. Where it departs from round 1, that is a deliberate change listed below. Paint your animal onto it.

## What to change

1. **One animal seen every way.** Paint every orthographic view onto its guide. Keep within about 12 pixels (3 cm) of the guide's outline everywhere except where fuzz softens the edge. The beak tip, eye, crest and its band, the bend of each wing, the wingtips, the ankles, toes and hands sit where the guide puts them. Measure it: the overlap of each painted mask with its guide mask (intersection over union), and the farthest distance between the two outlines, both ways. Report both, as you did in round 1.
2. **The gull's M.** From the front and from below, the spread wing is a shallow M: the arm rises from the shoulder to the bend of the wing, and from there the long finger runs out and a little down to the swept-back tip. Round 1's front view was flat. Follow the guide.
3. **The small hand sits at the bend of the wing,** where the long finger begins (about 1.52 m out from the midline in the spread views), not halfway along the arm: the landmark table in my first brief was wrong there. In flight its three small clawed fingers lie folded forward along the leading edge, small (about 12 cm), claws curled, low: not raised like paws. On the ground the animal stands on them.
4. **The folded wing on the ground, as in the guides.** The elbow lies back by the flank; the forearm and the long hand bone make one strut down to the hand on the ground; the wing finger is folded back up along the outside of that strut, past the elbow, and bends back to a tip that points up and back behind the body at about shoulder height. The membrane hangs at the side between the strut, the finger and the leg, gathered in soft folds of skin: the block-out's flat panels are a crude stand-in for those folds. Paint the skin within the guide's outline; slimmer is fine, outside is not. The chest is bent forward over the arms, so the rider sits upright on the ground: follow the guide's body.
5. **The under face of the membrane** is what players see most, against a bright sky, so it must read clearly as a coloured skin darker than the sky: a slate blue-grey of about #6F7C88, still a little paler and warmer than the upper face (#56677A), with the warm ash wash by the body and the charcoal tips. Round 1's under face measured a light grey, #878A8D.
6. **The harness.** Nothing may pass round the body behind the wing roots: the membrane grows along the flank from the shoulder to the hip, and a strap there would cut through it (round 1's rear girth does). The girth goes round the chest just in front of the shoulder joints; the straps cross on the breast and run round the base of the neck (the guide's two bands); the foot rests hang from the breast straps in front of the wing roots. The seat sits over the wing roots where the guide's pad is, the cantle behind it, the grips where the guide's posts stand, the reins from the halter on the beak to the grips. Keep round 1's saddle design and materials.
7. **The rider** is the guide's mannequin painted as the same plain adult survivor as round 1 (1.75 m standing, hide tunic and trousers, soft boots): seated as the mannequin is, leaning a little forward in flight and upright on the ground, thighs forward either side of the base of the neck, lower legs hanging in front of the wing roots, feet on the rests, hands on the grips. Keep the face plain; it is a scale figure.
8. **Finer surfaces.** As your report noted: the horn's grain and the membrane's veins finer and quieter, closer to the example's nuance; the crest thin in section seen from the front.
9. **Standing height.** Keep what you found: with the head level, the eye about 1.85 m up and the crest's top about 2.39 m. The guide has it.

Everything else as in `BRIEF_1.md`: the colouring, the canvases, the plain background (RGB 214, 212, 206), flat neutral light, no text, symmetric, no added parts. Do not search the web or look at other pteranodons; describe the animal in your own words in any prompt and name no game, studio or franchise.

## What to deliver

Replacing them at the top of this folder (keep `round1/` and `blockout_guides/` as they are):

1. The six orthographic views and their masks: `top`, `underside`, `front`, `side`, `folded_side`, `folded_front`.
2. `three_quarter.png`, in flight, the character picture (the guide's camera, or your own if it shows the animal better).
3. `head_side.png`, `head_front.png`: the head and crest large, for the modeller, as round 1, on the guide's head.
4. The saddle and rider: `saddled_side.png`, `saddled_folded_side.png`, `saddled_top.png` (on their guides, same canvases as the bare views, with masks), `saddled_three_quarter.png`, `saddle_detail.png`.
5. `regions_top.png`, `regions_underside.png`, `regions_front.png`, `regions_side.png`, `regions_folded_side.png`, `regions_folded_front.png`: each orthographic view as a flat region map on the same canvas and silhouette, in these pure colours only:
   - red (255, 0, 0): the charcoal marks: mantle, nape line, eye streak, the wingtips on both faces and the end of the wing finger;
   - green (0, 255, 0): the warm wash on the inner membrane by the body;
   - blue (0, 0, 255): the horn of beak, skull cap and crest; the skin of the hands, feet and toes;
   - cyan (0, 255, 255): the crest's band;
   - magenta (255, 0, 255): the rest of the membrane, both faces;
   - yellow (255, 255, 0): the ivory fuzz of head, neck, body and limbs, and the bony leading edge of arm and finger;
   - white (255, 255, 255): the eyes; black (0, 0, 0): the claws, the inside of the mouth if seen, and the background.
6. `variants.png`: the underside and the spread side view, each in six colourings, in natural tones, every region changing at once: for example a sand-grey body with an umber membrane, a pale buff body with a slate-green membrane, a dusky body with a pale grey membrane, an all-dark bird with a pale horn. The body stays paler than the membrane in most; the horn stays a clear mid to strong tone.
7. `read_sizes.png`: the underside and the side views, and their black silhouettes, with the span 128, 48 and 16 pixels wide, on one sheet. This is how it reads against the sky from far away.
8. `checks/` with this round's measurements and overlays, and `REPORT.md` with a section for this round at the top: what changed, how each picture was made, the overlap with the guides, how long it took, and what you are not satisfied with. Keep every script you write in this folder.

## What excellent looks like

The same studio-wall concept as round 1, now one animal seen every way. A modeller can trace any view and get the same creature; an animator can see the fold and believe it; a texture painter can follow one set of markings around it. From below, against the sky, the M of slate wings with dark tips and the arrow of the orange beak and crest say "pteranodon" at once, even as a black shape a few pixels wide; up close it is its own animal. And the rider looks as if the saddle was made for this animal.

Look at every picture you make, compare the views with one another and with the guides, and keep going until you would stand behind them.
