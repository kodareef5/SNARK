# Face painting, round 4: break the collar

The art director's review of the whole bird: where the neck's feathers meet the pink face there is a hard, straight line all round, like a turtleneck (front-left and side views, attached). It is straight because the model's regions run along its grid; only the paint can break it, and the face's margin is yours.

In the concept (`ref/concept/head_side.png`, `head_front.png`) the neck's grey feathers end raggedly on the skin: the last small feathers lie over the face's lower and rear edge, thinning out, with skin showing between them, as a vulture's or a real dodo's face margin does.

- **Paint the neck's last feathers onto your face piece's margin**, along every stretch of `shell_face` that meets the body's neck feathers (find them in the bird's own space with the position maps). Over a band 1.5 to 2.5 cm deep the feathers get smaller (from the neck's 1.5 to 2.5 cm down to 5 mm) and sparser, so that skin shows more and more between them until only a few small feathers stand alone on the skin. Draw them as the body's neck feathers are drawn (the accepted body study in `tex/studies/body/`, and the body's painted neck beside you, which `look.sh` shows), lying the way the direction field says, matching its value and scale exactly, so that no one can see where your piece ends.
- **Their region is body (red).** Your `dodo_regions.png` may now change the bake's regions on your own pieces (`compose.py` takes it). Body (red) and face (green) are not neighbours on the colour ring, so put black, at least 4 texels wide, between every feather and the skin: paint that black band in the base as what it is, the dark crease where a feather's edge lies on the skin.
- **The pouch's long edges** are the same line: let the neck's feathers lie a little over them too, the pleats fading under them.

Keep everything else as it is. Same layers and names; rerun, look with `zsh tex/paint/look.sh <dir>` (`head_front_left_*`, `head_side_*`, `bird_front_left_*`, and the loud dyes, where the red feathers on the green skin show exactly where you put them), and update your report.
