# Dirt: compacted footpath earth, from an open library

**Where it came from.** ambientCG's `Ground103` (CC0 1.0, as ambientCG's licence page states for all its assets), its
2K PNG colour, 16-bit displacement, roughness and ambient occlusion, fetched for this game on 2026-11-18. The files as
they came stay outside the repository; `source/rework.py` made these maps from them:
`python3 -I rework.py <Ground103 2K-PNG folder> Ground103 <out> 2 12 128,102,77 0.8 0.6`.

**What was done.**

- Colour: each channel's mean, in linear light, brought to the painted dirt's (sRGB 128, 102, 77), so the palette's
  dye and the city's tint fall on it as before; its own variation, crumbs, tracks and the odd blade kept.
- Height: the 16-bit displacement stretched to its full range, 12 mm from black to white.
- Roughness: three fifths of the way from the set's to fully rough, since it read glossy for dry, dusty ground.
- Occlusion: as it came. Tint: 0.8 everywhere, as the painted set had it on most of its area.
- Size: the set states none; 2 m reads right for its crumbs and tracks.

**Why it replaced the painted set.** The painted dirt (two rounds) was good from afar; this is real compacted earth
with track impressions at arm's length and as calm at 10 and 100 m.
