# Round 4 source record

This is a colour-only revision of the accepted round 3 build. The editable
procedural source is retained; no image generation, reference search or download
was used. The references inspected were our repository's `house_hero.png`,
`piece_wall.png`, and the upper-left skirt detail in `details.png`.

`round3/` freezes 56 accepted files before editing, including all delivered maps,
the builder, checker, guides, tier masters, relief arrays, measurements, evidence,
and report. `round3_archive_sha256.json` records their file hashes. The checker
continues to verify all earlier archives as well.

`round4_palette.json` replaces the active colour recipe; `round2_palette.json`
and `round3_placement.json` remain unchanged. The original geometry RNG and
round 2 appearance RNG consume the same values in the same order. A separate
round 4 colour RNG controls the fade endpoints and retained-gold/paler tips.
The original generated reed skins and full-size sheaf atlas remain the inputs.

Each bundle starts bleaching at 0.50 +/- 0.06 of its rod-to-end length and
uses a smoothstep through an independently chosen end position of 0.96–1.08.
The generated skin uses `guide/along.png`; analytic reeds use their unchanged
path coordinate. Reed onset varies a further +/- 0.035, and fade end varies
+/- 0.025. Some reeds retain more body gold (17% probability), a few have warmer
pale endpoints (8% probability). The mean target is measured from actual visible
tip pixels, not from the unmixed interpolation endpoint in the palette.

Bundle tone gain rises from 1.95 to 2.65. The same 196 dark reeds receive deeper
brown pigmentation, and negative fine fibre residuals get a stronger pigment
response. No guide-depth, directional light or broad cavity shadow is added to
base colour. The whole body mean is kept near (191, 146, 82). Roughness follows
the new reed bleaching; metalness remains zero and AO is unchanged.

The rebuild still computes the original height, normal and coverage. The checker
requires the height and normal PNG file bytes, relief NPZ bytes, base alpha,
both master alphas, and ORM red/blue channel bytes to match the frozen round 3
acceptance exactly. `checks/round4_preservation.json` includes both hashes and
changed-pixel counts for the channels.

The checker retains the independent RGB bundle-edge detection and its shifted
image/old-layout negative controls, tie detection, alpha enclosure/connectivity,
physical-scale normal agreement and repeat seam checks. New colour checks cover
the requested means, increased bundle contrast, deeper body darks, warm chroma
in every visible tip, and delivered RGB profiles sampled along both skirts.

Evidence includes a skirt beside an ungraded `house_hero.png` crop, round 3/4
under identical light, full ambient shade, 256-pixel-wide wall previews, two low
sun directions, adjoining walls, and native-size tip crops. These are the
existing orthographic guide-relief renderer; the reduced view is a distance
readability proxy, not a calibrated ten-metre game-camera capture.

Rebuild: `python3 build_material.py`.
Validate: `python3 check_material.py`.
Rebuild and prove all four delivered PNGs reproduce: `python3 check_material.py --rebuild`.
