# The berry bush atlas, round 6

Two things: the berries need a shape of their own in the light, and the folder needs only what makes the final atlas.

## Berries that read as fruit in every colour

The game now draws with real light: a sun, a sky table and exposure. The berries' dye still multiplies the base under region 0, scaled so the berries' mean comes out as the dye. A near-black bunch on dark leaves then reads as a hole: a flat dark disc has no shape. Give every ripe berry, on the sprays and in the three bunches, the look of a small glossy sphere with a bloom:

- **Inside region 0**: keep the body near the present grey (about 75 to 85), but paint it as a lit sphere: a soft paler bloom across the upper part, up to about 130 to 150, falling to the body grey, and the lower edge a little darker (about 55 to 65). The scaling keeps these ratios, so a near-black berry gets a grey-blue sheen on top and a red one a lighter red, and each reads round.
- **Outside region 0**: one small catchlight on each berry that faces the eye, 2 to 3 pixels, near white (230 to 245), upper left, consistent across the atlas. Being outside the region it stays white whatever the dye. Keep it that small: seen from far off it is averaged with the berry, and more would wash the colours pale.
- **Packed layer**: roughness about 0.35 under the catchlights, the berries as now elsewhere (0.62 to 0.70). Height and normal as now.
- Calyx dots, unripe berries, leaves, stalks, twins and every other pixel unchanged.

Show the six dyes (red, deep blue, violet, yellow-orange, near-black, white) on the bunches and one spray in a check picture against a dark leaf background, as round 5's.

## Only what the final atlas needs

The atlas is accepted as far as its leaves go, so its history can go. Rewrite `check_atlas.py` to check the final atlas on its own (sizes, rectangles, alpha, that region 0 is only berries, that the layers agree, and that `build_atlas.py` rebuilds them exactly), with no reference to earlier rounds. Then delete from `source/` whatever neither `build_atlas.py` nor the new check reads: earlier rounds' preserved layers and baselines, and `dead1`'s original and preserved layers if nothing reads them now. Keep every generated original the atlas is built from, the prompts, and the README, updated.

Rebuild every layer with `build_atlas.py`, run the new check, and add to `REPORT.md` what changed.
