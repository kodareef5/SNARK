# Study: the velvet fuzz

Read `tex/studies/COMMON.md` first and follow it. Your folder is `tex/studies/fuzz/`.

## What it shows

The covering of the head, neck, body and upper limbs, which the rider looks down on for as long as the animal is
ridden. In the design's words: a short, fine, velvety ivory fuzz; a charcoal mantle covers the back from the shoulders
to the hips and narrows into a line up the back of the neck. On the animal the ivory is region 5 and the charcoal
region 0; the colours are dyes, so your sets are grey.

- **The fuzz.** A pterosaur's covering of fine filaments: not feathers, not a mammal's guard hair, not felt, carpet
  or moss. Each filament is very fine, a few millimetres long (about 4 to 8 mm on the neck, body and limbs, 2 to 4 mm on
  the face), soft and a little wavy; they lie back along the body in a dense, velvety pile that gathers into soft locks
  and partings, with paler tips and darker roots. Up close it has fibres you can follow; at the animal's density it is
  the fine, soft, streaky texture of the concept's neck (`ref/concept/head_side.png`, `head_front.png` at about 1,000
  pixels a metre, and the chest and neck in `saddle_detail.png`, closer still); at 5 m it is an even, soft tone with the
  faintest grain along its lie. Look at the concept closely: its fuzz is plush and fine, with the light catching soft
  strands, never coarse.
- **The mantle's edge.** Where the charcoal mantle meets the ivory, on the flanks and either side of the nape line,
  the edge is the fuzz itself: the dark and pale locks interlock over a centimetre or two, so the edge is soft and
  ragged at arm's length and clean at 20 m (see `head_side.png` along the back of the neck, and `saddle_detail.png`).
  The region map follows those locks.

## Sets

1. `fuzz`: the fuzz of neck, body and limbs, region 5 over the whole picture. Tiles both ways, 2,048 pixels for 0.5 m
   (4,100 pixels a metre). The fuzz lies from the top of the picture toward the bottom. Form:
   `{"form": "ball", "radii": [0.2, 0.19, 0.3]}`.
2. `fuzz_face`: the shorter, finer fuzz of the face, the crown and round the eye, region 5 over the whole picture.
   Tiles both ways, 2,048 pixels for 0.25 m (8,200 a metre). It must sit beside `fuzz` without a visible change of
   character, only of length. Form: `{"form": "ball", "radii": [0.06, 0.07, 0.1]}`.
3. `mantle_edge`: region 0 in the upper part of the picture and region 5 in the lower, the edge wavering across the
   middle as the locks interlock. Tiles left to right (and top to bottom, where the two regions meet again across the
   wrap edge as a second, quieter edge, so that it tiles at all). 2,048 for 0.5 m, the same fuzz as `fuzz`. Each
   region's mean grey 0.50. Form: as `fuzz`.

## What excellent looks like

A stranger shown your `fuzz` at full size believes it is a photograph of a fine, soft animal pile, cleaned of its light,
and wants to touch it. On the egg in the game's renderer at 0.5 m it is the concept's velvety neck, not a pattern of
streaks; at 5 m it is a calm tone; and dyed hot pink, near-black or near-white it is still fuzz. The mantle's edge
looks like dark fuzz meeting pale fuzz, never a painted line or a torn edge.
