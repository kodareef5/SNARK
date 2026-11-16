# Study: the wing membrane

Read `tex/studies/COMMON.md` first and follow it. Your folder is `tex/studies/membrane/`.

## What it shows

Most of the animal is wing: 7 m across, about six square metres of skin on each face, and the under face is what
players see most, from below against a bright sky. In the design's words: a slate membrane of bare, matte, thin skin
with fine branching veins, taut on a long finger: darker on its upper face, a clear slate blue-grey on its under face,
a warm ash wash by the body, charcoal on the outer fifth. On the animal the membrane is region 4 (the slate), with
region 1 (the wash) by the body and region 0 (the tips) outboard; the colours are dyes, so your sets are grey, and all
of them are region 4 in the study.

- **The skin.** Thin, bare, living skin stretched taut: not leather, not rubber, not paper, not cloth, not a bat's
  wrinkled wing in a museum. Matte with a faint soft sheen; the faintest mottling of thicker and thinner skin; very
  fine creases where it gathers when the wing folds, lying mostly along the span and fading out in the middle of the
  wing where it is always taut.
- **The veins.** A sparse network of blood vessels in the skin. A few larger vessels, 2 to 3 mm wide, run from the
  arm and the body out across the wing and back toward the trailing edge, swept toward the tip, branching again and
  again into finer ones, down to half a millimetre, that end in the skin. Between them, open skin in cells of roughly
  4 to 10 cm. They are a little darker than the skin and very slightly raised. At a metre they are the delicate
  tracery that tells a rider this is skin; at 20 m they have fallen away into an even tone. Look at the faint veins in
  `ref/concept/three_quarter.png`, `top.png` and `underside.png`, and at the membrane in `saddle_detail.png`: subtle,
  never a road map.
- **Two faces of one skin.** The under face is the same skin seen from the other side, so it shows the same veins:
  make it the upper face's vein network mirrored left to right, so that a layout that puts the two faces back to back
  can line them up. Under it is paler, and its veins read a little more clearly against it, as skin does when the sky
  is behind it. The two faces' means differ (below), and together they average 0.50, as every dyed region must.
- **Direction.** In every set the picture's x runs along the span toward the tip (left to right), and its y runs
  chordwise from the leading edge (top) to the trailing edge (bottom); the main vessels come in from the top left and
  run down and to the right. The animal's painter turns and bends this field to the wing.

## Sets

All three tile both ways, 2,048 pixels for 1.0 m (2,000 pixels a metre, twice the animal's), region 4 over the
whole picture.

1. `membrane_upper`: the upper face. Mean grey 0.40 in linear light. Form:
   `{"form": "sheet", "width": 2.0, "depth": 1.0, "camber": 0.05, "face": "upper"}`.
2. `membrane_under`: the under face, the same veins mirrored left to right, mean grey 0.60. Form: the same with
   `"face": "under"`.
3. `membrane_creased`: the upper face where the skin gathers most, by the body, along the arm and at the fold of the
   wing finger: the same skin and veins with more of the fine creases and a few longer, softer pleat lines. Mean 0.40.
   The animal's painter blends it into `membrane_upper` near the bones, so the two must share their scale and
   character. Form as `membrane_upper`.

Roughness: matte skin, a little smoother than the body's fuzz and much rougher than horn; the veins a touch smoother.

## What excellent looks like

From the saddle, the inner wing a metre away is living skin: you see the veins branch, and the faint creases where it
folds. From below at 20 m it is a clean slate sheet whose tone holds against a bright sky, darker at the tips, with no
pattern, no blotch and no repeat. Dyed hot pink it is a hot pink membrane, not pink paper; dyed near-black it is still
skin. In the game's renderer (`bun tex/studies/look.ts tex/studies/membrane`), look hardest at the under face against
the sky at 1.5 and 5 m.
