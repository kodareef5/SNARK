# Clay: barrel roof tiles, from an open library

**Where it came from.** ambientCG's `RoofingTiles014A` (CC0 1.0, as ambientCG's licence page states for all its
assets), its 2K PNG colour, 16-bit displacement, roughness and ambient occlusion, fetched for this game on 2026-11-18.
The files as they came stay outside the repository; `source/rework.py` made these maps from them:
`python3 -I rework.py <RoofingTiles014A 2K-PNG folder> RoofingTiles014A <out> 2.9 60 keep 0.8 0`, and the module was
then set in `material.json`.

**What was done.**

- Colour: as it came (terracotta, sRGB mean 143, 91, 67); the palette's dye falls on four fifths of it.
- Height: the 16-bit displacement stretched to its full range, 60 mm from black to white.
- Roughness and occlusion: as they came.
- Size and module: the set states 2.9 m; it holds 19 columns of tiles across and 11 courses up, in line, so the
  module is a nineteenth across and an eleventh up.

**Why it replaced the painted set.** The painted clay read as flat slates from above; these are true barrel tiles,
and roofs are what the air sees. The weathered and broken states of the same set (`014B`, `014C`) are left for when
roofs are drawn with more than one finish.
