# Floor, round 2: more life

Round 1's earth in `../earth/` is accepted as it is. The floor in this folder is well made and checked, and it reads too plain: put `floor_base.png` beside `../../ref/concept/piece_foundation.png` and `house_inside.png`. The concept's floor is a golden mat of reeds you can see one by one, bound in rows of twined cord, with a little wear where people walk; yours is an even tan with faint lines, which from a few metres reads as a flat colour.

- Keep the layout (three mats a tile, seams on rows 683 and 1365 and the top and bottom edges, reeds left to right, cord rows every 25 to 30 cm), the 3 m span, your scripts as the way the set is made, and the checks.
- **Reeds you can see.** Each reed 4 to 8 mm across (3 to 5 pixels), round, with its own light and dark side and the odd node, laid side by side; reed to reed small changes of tone, and handfuls a little lighter or darker.
- **Colour.** Golden straw a little darker and more worn than the walls, the mean about (175, 135, 80), with a few darker trodden patches and a few pale ones.
- **Cord rows.** Twined cord a few millimetres thick that the reeds bulge between, as on the roof in `../roof/` (its round 2 is a good example of the detail wanted).
- **Seams.** At the mat seams, reed ends butt against each other, a little ragged.
- **Height.** About 12 mm full range, so reeds and cords read under a low light.
- **The wrap.** Bring the engine's seam measure under 2 for every layer in both directions. It compares the mean absolute difference between the last and first rows (and columns) with that between neighbouring rows (columns) inside: `seam_y = sum |p[h-1][x] - p[0][x]| * (h - 1) / sum |p[y][x] - p[y+1][x]|`, and the same across. Round 1's base measures 2.15 down.

Rebuild the four maps, rerun your checks (add a side-by-side with a crop of `house_inside.png` and the seam measure above), and update `REPORT.md`. Keep round 1's sources.

Do not use or imitate pictures from any existing game, and do not search for or download reference images. The concept pictures in this repository are ours.
