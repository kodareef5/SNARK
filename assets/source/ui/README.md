# Interface surface

`glass-source.png` is the generated transparent surface approved for the blue
glass HUD. It was made on 2026-11-15 with the image tool that
[prompts.json](../../../planning/reference/ui-hud-art/v2/prompts.json) names
(`built-in image_gen.imagegen`), from its last prompt; the same file is kept
there as `glass-surface-source.png`. The exact prompts and concept frames are
retained in [the design references](../../../planning/reference/ui-hud-art/v2/).

`tools/ui/assets.ts` takes the clean central half of the image, averages it in
premultiplied alpha, grades it to dark blue and combines it with the original
status silhouettes, controller diagram and exact borders from `client/core/ui/skin.ts`. The result
is a 512×448 RGBA atlas; only that derivative ships. Nine slices preserve the
corners and hairline edges. The full source and concept screenshots are never
requested by the game. No ARK art or icons are included.

SHA-256 of the preserved source:
`05511d46a17cc52264b313fd3e7134f5298599edc0d7a1429f65d6bcdd185368`.
