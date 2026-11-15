# Quills painted onto the current cards

Updated the tail and wing-finger layers for the modeller's revised cards. `paint.py` now reads `cards.tail` and `cards.finger` from `tex/paint/pieces.json` on every build: `card_mm` controls physical placement, and `mm_per_texel` controls relief derivatives and fine occlusion. It checks their rectangles against the current bake. There are no fixed card dimensions in the painting settings.

| Card | Previous rectangle, mm | Current measured rectangle, mm | Measured mm per 2048 texel, across/down | Feather target, width × length |
|---|---|---|---|---|
| Tail | 35 × 124 | 42.4 × 128.7 | 0.08276 / 0.10837 | 30 × 110 mm |
| Finger | 22 × 56 | 22.6 × 54.3 | 0.08507 / 0.08843 | 18 × 50 mm |

The accepted `tail_center` and `wing_finger_1` masters remain unchanged. The new mesh permits their full accepted proportions, replacing the previous tail width reduction and finger scale reduction. The taper compensation was refreshed from the current baked card faces and made dimensionless relative to their reference width; today's absolute width always comes from `pieces.json`. The frozen shape and its model hash are retained in [source/cards_geometry.json](source/cards_geometry.json). Changes to taper or topology require refreshing that shape input; changes to rectangle size are read automatically.

Both cards remain root down, tip up, with a 0.6 mm root margin. The tail is symmetric red region 0, with two yellow region 5 crescents, a body-coloured gap and terminal margin. The finger is entirely region 5. All seven tails and all eight fingers share their respective picture. The tail bands remain nominally 4.5 mm wide; measured shaft crossings are 4.44 mm each. Actual mesh instances vary around the median rectangle measurements.

## Verification

Ran the requested game preview:

```sh
python3 -I tex/paint/quills/paint.py
zsh tex/paint/look.sh /home/user/dev/SNARK/.claude/worktrees/agent-a4178178ffa393e0e/assets/source/core/creatures/dodo/tex/paint/quills/checks/resize_game
```

Inspected the [default side view](checks/resize_game/bird_side_default.png), [back view](checks/resize_game/bird_back_right_default.png), [loud dyes](checks/resize_game/bird_side_loud.png), [back close-up](checks/resize_game/back_bars_default.png), and the game-rendered size strips. The revised side fan shows seven separate banded feathers, and the four wing fingers overlap while staying distinct. Both cream bands remain readable. The [nape](checks/resize_game/nape_default.png) and [hood edge](checks/resize_game/hood_edge_default.png) shots were also inspected; they show the other groups' state at render time and were not painted by quills.

The Python reviews were refreshed against the same composition and current card geometry. [Material validation](checks/validation.json), [512-atlas checks](checks/game_checks.json), [source comparison](checks/source_comparison.png), and [four-dye material views](checks/physical_card_dyes.png) are in `checks/`.

| Covered area | Mean linear grey | Value standard deviation |
|---|---:|---:|
| Tail body, region 0 | 0.500013 | 0.072124 |
| Tail bands, region 5 | 0.500023 | 0.059707 |
| Finger, region 5 | 0.500002 | 0.062433 |

RGB channel spread is zero, each feather is one connected cutout, and every field is zero outside the two owned rectangles. Both bands survive as separate 10-pixel shaft crossings in the final 512 atlas, with the body-coloured tip margin intact. Maximum tested base/light correlation is 0.00585. Full-white height remains 1.4 mm, with visible material heights approximately 0.206–0.471 mm. The shared composer now uses the same measured anisotropic texel sizes, resolving the earlier atlas-wide normal-scale approximation.

A clean rebuild with `layers/` moved aside reproduced **all ten layer PNGs and `layers.json` byte for byte**; [resize rebuild hashes](checks/resize_rebuild.json) record both sets. The five opaque layers remain empty because this group owns no opaque pieces. The five card layers are all 2048; no normal map is delivered. The accepted study was not edited.

The game views still show some narrower tail silhouettes from behind because of each card's orientation. Fine strands merge at distance, and the two individual bands average away on the smallest birds. The current render also shows gaps around the nape and hood edge, outside this group's ownership. The earlier side-view edge-on tail limitation is substantially improved by the modeller's new fan orientation.

## Files and rebuild

Keep `paint.py`, `review.py`, this report and `source/cards_geometry.json`. `layers/`, `checks/` and `superseded/` are ignored. Previous painting scripts, report, shape snapshot and layers are archived in `superseded/before_card_resize/`. The accepted study supplies the unchanged per-element cutout, height, packed and band layers. `layers.json` records all input hashes, current measurements, placement and physical settings.

For the optional Python reviews, compose into `tex/paint/quills/checks/composed`, then run `python3 -I tex/paint/quills/review.py`. The current resize pass took approximately five minutes on 2026-11-15, including the game renders, numerical checks and clean rebuild comparison.
