# Paint the head

Read `tex/paint/BRIEF.md` first and follow it (it points you at `tex/studies/COMMON.md` and `ref/DESIGN.md`). Your
group is `head`: on `pteranodon`, the pieces `head` (the face, the skull cap, the back of the head and the throat),
`beak`, `jaw` (with the palate, the inside of the mouth), `crest` and `eye_l`. Your folder is `tex/paint/head/`. The
neck below the head is the `body` painter's.

## What it is

The head is the largest part of the animal and the first thing anyone recognises, and a rider looks at the back of it
for as long as they fly. In the design's words: the beak is a long, straight, toothless needle of smooth orange horn
with faint growth lines, the upper jaw a little longer than the lower and its tip turned very slightly up; a low sharp
keel runs along its top. The gape runs straight back to below the front of the eye, a small slit nostril sits near the
beak's base. The horn continues over the top of the skull as a cap and rises into the crest: one solid blade, tapering
to a rounded point, with one broad charcoal band across it near the tip. The horn meets the face's ivory fuzz in a line
just in front of the eye. The eye is small and dark amber under a slight brow, set in a charcoal streak that runs back
to the nape. See `ref/concept/head_side.png` and `head_front.png` (about 1,000 pixels a metre), `concept.png`.

- **The horn** (region 2) is the horn study (`tex/studies/horn/`): its stippled, banded keratin, sampled at its
  physical scale and turned so its growth lines run along the beak and jaw toward their tips and up the crest toward
  its point, as `head_side` shows; sparse at the needle's tip, denser on the crest and cap; the tips and cutting edges a
  little paler and smoother, with the few fine scratches of use. Its `head_side` panel shows where everything sits
  along the head; lay the same things onto the model through the position maps: the keel along the top of the beak,
  the gape line, the nostril as a narrow slit some 6 cm long with a soft rim and a darker floor (the study's is too
  short and oval), the cap's edge in front of the eye.
- **The band** (region 3) across the crest near its tip, as in the concept: clean, nearly straight edges across the
  blade, the horn's grain running through it. The guide's band is stepped along faces; place the real one.
- **The face** (region 5): the fuzz study's `fuzz_face`, short and fine, lying back from the beak toward the nape
  (`pteranodon_flow.png`), meeting the horn's edge in a narrow, slightly dark crease where its tips lie over the horn.
  The throat under the jaw the same fuzz, paler-looking only by its form.
- **The eye streak** (region 0): a charcoal band of the same fuzz from the base of the beak through the eye back to
  the nape, about 2.5 cm deep at the eye, where it meets the body painter's nape line at the top of the neck (agree it
  by position). Its edges are soft interlocking fuzz, as the fuzz study's `mantle_edge`.
- **The eye** (`eye_l`, undyed): the skin study's `eye` (`tex/studies/skin/`): the dark amber iris with its pupil, the
  thin bare lid, the brow's soft shadow in the height and occlusion; the lid's skin is in the streak.
- **The mouth** (the palate and the inside of the jaw, undyed): the skin study's `mouth`, pale pinkish grey with its
  ridges, seen only in a bite or a call.

## What excellent looks like

Beside `head_side.png` and `head_front.png` at the same pixels a metre the painted head is the concept's: the orange
needle and sabre with one crisp dark band, the stippled horn, the cap's edge in front of the amber eye, the streak, the
ivory fuzz. From the saddle (`rider_*`) the back of the head and the crest read as horn and fuzz; at 60 m from below
the beak and crest are a clean orange arrow. Dyed loud or dark it is still horn, fuzz and an eye.
