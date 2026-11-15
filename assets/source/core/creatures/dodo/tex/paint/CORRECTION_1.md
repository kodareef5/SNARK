# Correction to the shared painting maps

Two faults in `tex/paint/position_x/y/z.png`, both mine, are fixed:

1. **They held the bird's right side.** Both halves share the texture, and the maps kept whichever half was drawn last, which was mostly the right (x negative). They now hold the left side everywhere (x from 0 at the midline to +0.144 at the flank), the side the layout names and the side `ref/bakes/dodo_normal_object.png` describes, so position and normal agree without any reflection.
2. **The crown was clipped.** The maps' range stopped at y = 0.6491 while the bird reaches 0.6527; the range now comes from `ref/bakes/bakes.json`, widened by 2 mm each way, and `pieces.json` gives it as `position_box`.

`pieces.png` and `texel_mm.png` are unchanged. Run your `paint.py` again so your layers are made from the corrected maps, and take out any reflection of positions or normals you added to cope with the old ones. Check that everything you placed by position (an eye, a fold, a groove, a bar) lands where it should, then report briefly what changed.
