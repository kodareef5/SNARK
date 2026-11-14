# Thatch wall, round 3: the same wall on a new layout

Round 2 is accepted as a picture: its golden bodies, cream tips, reed-to-reed life and tie impressions are what this wall should look like. But the model it is painted to has changed, so it must be laid out again on the new guides. The geometry now matches the concept more closely:

- **Bigger bundles.** The upper tier now has fewer, broader sheaves (15 to 32 cm) and the lower tier the same (16 to 34 cm), as `house_hero.png` and `piece_wall.png` have them. `guide/bundles.png` and `guide/layout.png` show the new edges; `guide/LAYOUT.json` lists them.
- **The rods moved.** The upper rod is now at 2.62 m and the lower at 1.20 m above the floor (rows 157 and 1126 in the picture; the brown bars in `guide/layout.png`). The ties and their pressed cord marks move with them. Below each tie, every bundle bellies out to its tips.
- **The skirts' outlines** (`guide/envelope.png`) are new. The tip zones still begin at 1.66 m (upper) and 0.24 m (lower).
- **The bundles lean** a few degrees in the model below their ties. That is done by the geometry, which carries the picture with it: keep painting the bundles straight up and down in the picture, as the guides have them.

Everything else from rounds 1 and 2 stands: the 3 m by 3 m layout from 0.15 m below the floor, the left-right wrap, alpha 0 or 255 with real ragged tips inside the envelope and nothing outside it, the colours, the four maps and their encodings, your build and check scripts as the way the set is made, and the checks. As before, what lies under alpha 0 in the upper tip zone and the cut top of the wall do not matter.

Rebuild the set on the new guides, rerun your checks (add a check that every bundle's edge in your base colour falls where `bundles.png` puts it), and update `REPORT.md`. Keep earlier rounds' sources.

Do not use or imitate pictures from any existing game, and do not search for or download reference images. The concept pictures in this repository are ours.
