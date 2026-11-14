# Miami production state

**Round three complete — 2026-11-14, 21:48 UTC.** All 85 final tiles and the
20 replacement originals are in place. No production process remains running.
No git command that writes was run.

- Water at z0–2 now has independently painted native detail and broad structure
  from NOAA's 2015 Miami coastal elevation model. Its lossless subset, licence,
  checksum, datum and georeference correction are retained. Existing world
  layers and the engine coordinate conversion are unchanged.
- Five far landmark stories are distinct: banyan arcade, unequal drowned
  towers, reed bowl, stepped Deco gallery and mangrove tanks. The port sheds,
  cranes, drowned ground, broken spans and accepted land passages remain.
- Far mainland quays have a narrow varying ink line in place of the old dashed
  double trace. Z2 land and z3 rooms/waves are retained; broad pigment is shared
  across scales. All 64 z3 originals are byte-identical to round two.
- Format/base audit passes: 85 RGB 1,024² tiles, 85 originals and prompts,
  zero reconstruction error, all 21 existing base data artifacts unchanged.
  All 140 joins checked: worst immediate ratio **1.2146**. Adjacent-zoom broad
  RGB errors at sigma 8 are **0.909, 1.695, 0.580 /255**. Water-pigment IoU is
  **0.981, 0.983, 0.993, 0.995**. Diagnostic limits are stated in REPORT.md.
- Far registration rebuilt without caches exactly; three z2 registrations
  match exactly in parameters and non-overlap interiors. A repeated complete
  balance/export reproduces all 85 tile SHA-256 hashes.
- Viewed both overviews side by side, all zooms and all tile contact sheets,
  native water/rooms, landmarks, mainland quays, worst joins, pigment outliers
  and representative marker overlays. Review evidence lives under
  `reports/round3/`. The prior report is `reports/round2-report.md`.

Use the **round-three** sequence in `tools/mapart/README.md`. Kept
`paintings/z*/retained-paint.png` files are intentional inputs verified against
the preceding 85 tiles. Frozen generation-time parents are also kept. Do not
run historical round-one/two finishing entry points over the new originals.
Ignored references, registration images and finishing masters can be rebuilt
offline from the retained files; no new image call or git access is needed.

The requested repaint is finished and ready for review. Remaining weaknesses
are stated plainly in REPORT.md: peripheral small marks still repeat, far
pictures change convention at close scale, small span breaks are subtle,
historical depths do not establish modern dredging/coral/former shorelines,
and the marker study is illustrative rather than an engine UI test.
