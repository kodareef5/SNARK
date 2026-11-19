# Interface surface

`glass-source.png` is the generated transparent surface approved for the blue
glass HUD. It was made on 2026-11-15 with the image tool that
[prompts.json](../../../planning/reference/ui-hud-art/v2/prompts.json) names
(`built-in image_gen.imagegen`), from its last prompt; the same file is kept
there as `glass-surface-source.png`. The exact prompts and concept frames are
retained in [the design references](../../../planning/reference/ui-hud-art/v2/).

`tools/ui/assets.ts` takes the clean central half of the image, averages it in
premultiplied alpha, grades it to dark blue and combines it with the original
status icons (below), controller diagram and exact borders from `client/core/ui/skin.ts`. The result
is a 512×448 RGBA atlas; only that derivative ships. Nine slices preserve the
corners and hairline edges. The full source and concept screenshots are never
requested by the game. No ARK art or icons are included.

SHA-256 of the preserved source:
`05511d46a17cc52264b313fd3e7134f5298599edc0d7a1429f65d6bcdd185368`.

## Status icons

`vitals-source.png` is a generated sheet of sixteen status glyphs on pure black, in the touch glyphs' style; its
prompt is in `PROVENANCE.md`. As the build makes the HUD sheet, `tools/ui/vitals-art.ts` paints its first seven
(health, stamina, food, water, oxygen, torpor, weight) over the shapes drawn by rule: the silhouette, the fill, the
warning's fill and the outline of each, in the sheet's own 64-pixel cells. Without the picture the old shapes are
drawn. The other nine glyphs (heart, shield, thermometer, snowflake, flame, skull, star, moon, sun) are not yet used.

## Touch controls

`touch.png` is the touch controls' sheet, 1536 by 912: glass buttons at rest and lit, the stick's ring and knob, a
pill and 48 glyphs, cut for a phone's own pixels. `touch.webp` is the copy the build ships (quality 90, alpha exact).
`bun tools/ui/touch-art.ts` makes both from the five generated pictures in `touch/`, which were asked for on pure
black so that black could become transparency. It measures each part's rim, brings it exactly round or square and to
its cell's size, puts dark glass under it, and measures what it placed, failing on a part off its size or centre. A
page fetches the sheet only when a touch control is drawn. Without it the game draws plain rings and discs and words.
