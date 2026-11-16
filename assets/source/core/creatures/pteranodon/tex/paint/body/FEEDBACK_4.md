# Body, round 4: the foot band, after the modeller's fix

The modeller fixed the foot: the leg's last ring of faces, the horn-coloured band from the ankle to the ball of the
foot, now spans about 11 cm along the foot instead of 2. The layout is pinned and unchanged; the bakes and
`tex/paint/pteranodon_*` maps were made again from the new model, and your `paint.py` has been run on them. The attached
picture is the game's renderer on the result (`feet`): the band is now a plain, smooth orange sleeve, its drawing
stretched about five times along the foot until nothing reads.

Repaint that band for its real size: down the front (top) of the foot the transverse scutes of the skin study, each
3 to 6 mm along the foot, overlapping, running on into the scutes of the toes; on its sides and back the fine pebbled
skin; at the ankle the fuzz of the shin thinning onto it as now. Measure it in the animal's space (the position and
texel-size maps), not in the layout, so it holds whatever the band's texels span. Change nothing else: every other
texel of your layers stays as it is. Look at `feet` and `three_quarter` in the game's renderer before you stop, update
the report, and keep the rebuild byte for byte.
