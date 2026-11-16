# Paint the body, the legs and the small parts

Read `tex/paint/BRIEF.md` first and follow it (it points you at `tex/studies/COMMON.md` and `ref/DESIGN.md`). Your
group is `body`: on `pteranodon`, the pieces `torso`, `neck`, `leg`, `toe_0` to `toe_3` and `hand_0` to `hand_2`. Your
folder is `tex/paint/body/`. The head, beak, jaw, crest and eye are another painter's (`head`); the wing and its arm
another's (`wing`).

## What it is

In the design's words: the body is short and deep, covered in a short, fine, velvety ivory fuzz. A charcoal mantle
covers the back from the shoulders to the hips and narrows into a line up the back of the neck. The neck is stout,
rising forward from the shoulders. A tiny stub of a tail. The legs are thin, with orange horn-skinned grasping feet:
four long toes with long, strongly curved dark claws. At the bend of each wing a small hand of three curved claws.

- **The fuzz** of the fuzz study (`tex/studies/fuzz/`, in its last round: read its layers and elements when your
  script runs), lying along `pteranodon_flow.png`: back along the neck and body toward the tail, down the flanks, down
  the legs; at its own scale on the neck and body (each texel there is 0.8 to 0.95 mm), finer and shorter toward the
  head end of the neck where it meets the head's face fuzz, and on the lower leg where it gives way to the foot. It
  wraps the body without a visible seam where pieces meet, and is symmetric along the midline of back and belly.
- **The mantle and the nape line** (region 0): the charcoal saddle-cloth of fuzz over the back from the shoulders to
  the hips, its lower edge along the flanks where the concept's `top.png`, `side.png` and `three_quarter.png` put it,
  and its front narrowing up the back of the neck into a line some 4 to 5 cm wide that runs to the nape, where the head
  painter's eye streak meets it (agree the place by position: the neck's top end at the back of the skull). Its edges
  are the fuzz study's `mantle_edge`: dark and pale locks interlocking over a centimetre or two, wandering. The guide
  in `ref/bakes/pteranodon_regions.png` is stepped along faces; paint the real, smooth edge.
- **Where the rider sits.** The saddle is a separate mesh that sits on the fuzz over the shoulders and the base of the
  neck; paint the fuzz as it is there, unpressed. (Its contact shadow belongs to the saddle's own maps.)
- **The leg and foot** (region 5 fuzz on the thigh and shin, region 2 horn-skin below): the fuzz thinning down the
  shin to the bare, orange horn-skinned ankle and foot, the change soft. The skin study's (`tex/studies/skin/`)
  `scutes` across the top of the foot and of each toe, its pebbled `skin` on the sides and soles, and its `claw` on
  each claw (undyed, black in the region map), each at its real size: the toes about 10 cm long and 1 cm thick, the
  claws about 4.5 cm along the curve.
- **The small fingers** (`hand_0` to `hand_2`): the same horn-skin, finer, and their claws.
- **The stub of a tail** at the end of the torso: fuzz, a touch darker where it tucks in.

## What excellent looks like

From the saddle (`rider_*`) the neck in front of the rider and the shoulders are the concept's velvet ivory with the
charcoal line running up the back of the neck; from above (`above_*`) the mantle is the concept's clean dark saddle
shape with soft edges; from below at 60 m the body is a pale spindle between the wings; the feet are a wading bird's
orange feet with dark claws (`feet_*`). Dyed loud or dark it is still fuzz and skin.
