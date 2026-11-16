# Study: the horn of beak, cap and crest

Read `tex/studies/COMMON.md` first and follow it. Your folder is `tex/studies/horn/`.

## What it shows

The head is the largest part of the animal and the first thing anyone recognises: 1.45 m from beak tip to crest tip,
its horn a strong colour against the ivory face. In the design's words: the beak is a long, straight, toothless needle
of smooth orange horn with faint growth lines, the upper jaw a little longer than the lower and its tip turned very
slightly up; a low sharp keel runs along its top. The gape runs straight back to below the front of the eye, a small
slit nostril sits near the beak's base. The horn continues over the top of the skull as a cap and rises into the crest:
one solid blade, flat from side to side like a sabre, tapering to a rounded point, with one broad charcoal band across it
near the tip. The horn meets the face's ivory fuzz in a line just in front of the eye. On the animal the horn is region
2 and the band region 3; the colours are dyes, so your sets are grey. See `ref/concept/head_side.png` and
`head_front.png` (about 1,000 pixels a metre).

- **The horn.** Keratin over bone, alive and used: smooth and satin, not plastic, not glazed pottery, not brushed
  metal, not orange peel, not wood. Faint growth lines run along the beak toward its tip and up the crest toward its
  point, broken and coming and going; a fine stipple of tiny pits and bumps, as the concept's crest has; soft
  mottling of slightly paler and darker horn; a few fine scratches near the tip and along the cutting edges, where a
  fish-catching beak is used. All of it subtle: at the animal's density it reads as horn, at 5 m as a clean strong
  colour.
- **The band.** The charcoal band is pigment in the same horn, so the horn's grain runs straight through it; its edges
  are clean and nearly straight across the blade, as in the concept, with the slight irregularity of a natural
  marking.
- **The edge with the face.** Where the cap meets the fuzz in front of the eye, the fuzz's tips lie over the horn's edge
  in a narrow, slightly dark crease.

## Sets

1. `horn`: the plain horn, region 2 over the whole picture. Tiles both ways, 2,048 pixels for 0.4 m (5,100 pixels a
   metre). Its growth lines run left to right (along the beak). Form:
   `{"form": "tube", "radius": 0.05, "flat": 0.35, "taper": 0.12, "length": 0.8}`.
2. `head_side`: one picture that is not a tile: the side of the head's horn laid flat, beak tip at the left, crest tip
   at the top right, in the proportions and the pose of `ref/concept/head_side.png`: the upper and lower jaw with the
   gape between them, the keel along the top, the nostril, the cap over the skull to its edge in front of the eye, the
   crest with its band. 2,048 pixels for 1.5 m. Region map blue on the horn, cyan on the band, black elsewhere (the
   gape's line and the face are someone else's). It shows where everything sits; the animal's painter will lay the same
   things onto the modeller's head. Form: `{"form": "none"}`.

## What excellent looks like

Up close, from the saddle, the beak is old, living horn you could tap with a fingernail: faint growth lines, fine
pits, a few scratches, a satin sheen. Shrunk to the animal, it is the concept's clean orange needle and sabre with
one crisp dark band. Dyed charcoal, pale horn or lime, it is still horn.
