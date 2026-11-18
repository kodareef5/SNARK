# Paving: a sidewalk of 1 m slabs, from an open library

**Where it came from.** Poly Haven's `large_square_pattern_01` (CC0, as Poly Haven's licence page states for all its
textures), its 2k colour, displacement, roughness and ambient occlusion, fetched for this game on 2026-11-18. The
files as they came stay outside the repository; `source/rework.py` is the script that made these maps from them.

**What was done.**

- Colour: each channel's mean, in linear light, brought to a neutral concrete grey (sRGB about 128, 125, 119), which
  took out the photograph's warm cast; the slabs' own variation, the gravel, grit and weeds in the joints are kept.
- Height: the displacement is 8-bit, so it was softened by a pixel (Gaussian, 0.9) so that its steps do not show as
  terraces in a low sun, then stretched to the full 16-bit range. 25 mm from black to white.
- Roughness and occlusion: as they came.
- Tint: the slabs take a lot's colour and the joints keep their own, from the height (the lowest tenth none, from
  the thirtieth percentile up all).
- Size and module: the tile is 3 m with three slabs each way; the joints sit on the tile's edges and thirds, so the
  module is a third both ways.

**Why it replaced the painted set.** The painted paving was neat 50 cm slabs with clean joints, judged good after
three rounds; this is a sidewalk the city has left alone, grit and growth in every joint, which is what a street of
this game should read as at eye height. It is a regular grid from far off, as a sidewalk is.
