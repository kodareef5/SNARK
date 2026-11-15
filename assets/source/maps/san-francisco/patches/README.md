# Generator changes waiting for Miami's third round

Miami's third round of ruins (`r9/miami-ruins`) was changing `tools/mapworld/` and `content/miami-ruins.ts` while San
Francisco was made, so San Francisco's changes to them are patches against main at 1e674698, not edits. Every picture,
walk and number in `../REPLICATION.md` comes from a copy of the repository with all of them applied:

```sh
mkdir -p .cache/scratch && git archive HEAD | tar -x -C .cache/scratch
cd .cache/scratch && for p in ../../assets/source/maps/san-francisco/patches/*.patch; do git apply "$p"; done
```

Applied to main after the third round lands, each needs only its context lines moved.

| Patch | Why |
| --- | --- |
| `01-mass8-shape.patch` | An 8 m solid block in every finish (`core:zruin_mass8_*`, eight new statics). A bridge tower 227 m tall filled with the 4 m `crown` alone is about 850 blocks, near a chunk's budget of 1,000 with the deck beside it; with 8 m solids it is about 120 |
| `02-suspension-bridges.patch` | A rule for any way OpenStreetMap marks `bridge:structure=suspension` (or `cable-stayed`), new in `suspension.ts`: the towers from the parts OpenStreetMap maps in three dimensions (`blocks/supports.json`), filled between each part's `min_height` and `height` with the lowest reaching the bed; two cables from each tower top, a parabola across the main span with its low point 3 m over the deck and side spans down to the deck at three tenths of the main span; hangers every 16 m. Without it the Golden Gate's deck fell at 10% from its 65 m ends toward a motorway's 8 m, on piers every 31 m down to a 100 m deep bed, with no towers. The deck of such a way now keeps the height it left the land at (a grade of 0.5% in place of 10%), and has no piers over the water. A way whose layout gives no pieces is reported "no pieces", not "budget rejected" (Tampa's finding 14) |
