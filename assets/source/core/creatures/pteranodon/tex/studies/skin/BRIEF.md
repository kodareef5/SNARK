# Study: the feet, the claws, the eye and the mouth

Read `tex/studies/COMMON.md` first and follow it. Your folder is `tex/studies/skin/`.

## What it shows

The small parts a rider sees when the animal lands and walks, and a player sees when it bites or calls. In the
design's words: thin legs with orange horn-skinned grasping feet: four long toes with long, strongly curved dark
claws; the small hand at the bend of the wing, three curved claws; the eye small and dark amber under a slight brow,
set in a charcoal streak. The feet's and fingers' skin is region 2 (the horn's dye, so the feet match the beak); the
streak round the eye is region 0; eyes, claws and the inside of the mouth are never dyed. See
`ref/concept/head_side.png`, `head_front.png`, `three_quarter.png`, `folded_front.png` and `concept.png`.

- **The feet's skin.** Like a long-legged wading bird's: across the top of each toe and down the front of the foot,
  overlapping transverse scutes about 3 to 6 mm long; on the sides and between them, fine rounded pebbles of 0.5 to
  1.5 mm; the undersides padded and finely pebbled. Dry, matte to satin, horny. The small fingers of the hand have the
  same skin, finer.
- **The claws.** Long, strongly curved, laterally flattened, dark: near-black brown-grey horn with fine growth lines
  along the curve, a paler, smoother worn tip and a few nicks. Polished.
- **The eye.** About 18 mm across: a dark amber iris with fine radial texture, darker at its rim, a round black pupil,
  a slight brow above; the lid rim a thin ring of bare, finely wrinkled skin. The cornea's wetness is roughness, not a
  painted highlight. The skin of the lid and round it is in the charcoal streak (region 0); the eye itself is undyed.
- **The mouth.** Inside the long jaws, seen in a bite or a call: pale, pinkish-grey lining, smooth with faint
  longitudinal ridges, a little moist. Undyed.

## Sets

1. `skin`: the pebbled skin of the toes' sides, the soles and the small fingers, region 2. Tiles both ways, 2,048
   pixels for 0.2 m (10,000 pixels a metre). Form: `{"form": "tube", "radius": 0.012, "taper": 0.6, "length": 0.3}`.
2. `scutes`: the transverse scutes across the top of a toe and the front of the foot, with the pebbles where they end,
   region 2. Tiles both ways, 2,048 for 0.2 m; the toe runs left to right, the scutes cross it top to bottom. Form:
   as `skin`.
3. `claw`: one panel of a claw's side laid flat, root at the left and tip at the right, curving down, about 45 mm along
   its curve, with a margin of the same horn round it; undyed (region map black). 2,048 for 0.06 m. Form:
   `{"form": "none"}`.
4. `eye`: one panel: the eye at the middle with its lid ring and the skin round it to the panel's edge. Region map
   black on the eye and lid rim's inside edge, red on the lid's skin and round it. 2,048 for 0.05 m. Form:
   `{"form": "none"}`.
5. `mouth`: the mouth's lining, undyed. Tiles both ways, 2,048 for 0.2 m, the ridges running left to right. Form:
   `{"form": "tube", "radius": 0.02, "flat": 0.5, "length": 0.6}`.

## What excellent looks like

The feet are a wading bird's feet you could believe in, in orange or any dye; the claws are glossy dark hooks with a
worn point; the eye is alive and sharp, the one undyed spot of warm colour in the face; at the animal's density each
still reads (scutes as fine bands, pebbles as a grain, the eye as amber with a pupil), and at 5 m each falls into a
clean tone.
