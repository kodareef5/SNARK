# Saddle, round 3: the script, after the modeller's fix

The modeller moved the saddle onto the body's real faces: the straps, girth, collar and boss now clear the body by 2
to 4 mm, and the cantle's and grips' feet are set into the seat. The layout and topology are pinned and unchanged; the
bakes and `tex/paint/pteranodon_saddle_*` maps were made again from the new model. On the game's renderer your
accepted layers sit right on it now (the white patches where the straps crossed are gone).

But `paint.py` no longer runs: it rebuilds the parts by executing `saddle.py`'s own construction, and that has changed
(`cantle_part(seat)`, `grip_part(side, seat)`, and the straps and boss now measure against the body's faces as built,
a Blender object, `BODY`). Make `paint.py` independent of how `saddle.py` builds its parts: take what it needs from
what the modeller publishes as data, which is pinned: `saddle_layout.json` (each part's faces, pieces and corner
coordinates), the bakes in `ref/bakes/` and the maps in `tex/paint/` (each texel's piece, position, normal and size).
Rim paths, tube directions and lengths can all be measured from those. It must run without Blender, and keep running
when the modeller next refines the saddle's shape under the same layout.

Then run it on the new bakes, and check that what it paints is your accepted saddle: the same materials, stitching,
grain, rope and chitin, now following the parts as they sit. Look at `saddled_front`, `saddled_seat`, `saddled_side`
and `saddled_rider` in the game's renderer (`zsh tex/paint/look.sh <folder> --maps`) before you stop. Update the report
and its "Files" section, and keep the rebuild byte for byte from run to run.
