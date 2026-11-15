# The saw palmetto atlas, round 2

Read `BRIEF.md` and `../BRIEF-common.md` again: everything there still holds. The fans, dead fans and trunk of your first set are excellent and stay exactly as they are. One element is wrong for how the game uses it.

**The stalk column.** The script wraps the stalk column round a thin modelled stem, a tube 1.5 cm thick, so the column is not a picture of a stalk on an empty background: it is **the stalk's surface unrolled**, filling the whole 64-pixel width and fully opaque from edge to edge, repeating from bottom to top. As it is, three quarters of it is alpha 0, so in the game the stalks vanish and the fans float. Paint the full width as the skin of the stalk: pale yellow-green, a little paler down the middle (its upper face) and darker toward both sides (its flanks), with fine lengthwise fibres, the odd brown scuff, and the teeth shown as a row of small sharp darker marks down each side a few pixels in from the edge (they cannot stand out from a tube, so they are painted). Its height map: the fibres and the tooth marks only; the roundness belongs to the tube. Keep `metres` 1.0 and the seamless vertical repeat.

Nothing else changes. Rebuild every layer, run every check again, and add to `REPORT.md` what you changed.
