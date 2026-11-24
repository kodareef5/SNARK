# Small details

Feathers knocked loose, dust thrown up, a splash: the small pictures that follow what a body does. A creature gets
them from one sheet in its folder and a few pictures, with no engine code. The dodo is the worked example:
[`core/creatures/dodo/cues.json`](core/creatures/dodo/cues.json) and its [`details/`](core/creatures/dodo/details/).
How the engine draws them is in [round9-details-design.md](../../planning/reference/round9-details-design.md).

Details are pictures. Every client that saw a body do something makes the same particles from it, and nothing reads
them back: they never change what happens.

## The sheet: `cues.json`

```json
{
  "cues": {
    "land": { "sounds": ["land"], "effects": [{ "effect": "feathers_burst", "from": "body" }, { "effect": "scuff", "from": "ground" }] },
    "down": { "effects": [{ "effect": "dust_ring", "from": "ground", "at": "down" }] }
  },
  "effects": { "feathers_burst": { "pictures": ["contour"], "count": [3, 5], "...": "..." } },
  "pictures": { "contour": { "file": "details/contour.png", "regions": "details/contour_regions.png", "flat": "feather" } }
}
```

**`cues`**: what the creature answers, each with its `sounds` (names in `sound/sounds.json`) and its `effects`.

| Occasion | When |
| --- | --- |
| `thrown` | it leaves a survivor's arms in the air, fast |
| `land` | it lands hard, alive (its `land` clip plays), or sets down from flight; or knocked out, or dead after dying in its own flight, it reaches the ground |
| `take_off` | it takes off from the ground or the water |
| `struck` | it flinches from a blow |
| `down` | it is knocked out on the ground or in the water and goes down |
| `death` | it dies in view and falls |
| `up` | it comes round and gets up |
| `splash` | it falls into water |
| `step` | a foot comes down while it runs |
| `peck` | its `idle_peck` clip meets the ground |

An entry names an `effect` and where it starts, `from`: `body` (its torso), `hit` (where it was struck, away from the
striker), `ground` (under it, as wide as it lies), `foot` (the foot that came down) or any socket of its rig
(`beak_tip`). `at` is `now`, `down` (the moment its body meets the ground in the occasion's clip, read from the clip)
or seconds. `count` changes the effect's count for this entry, and `on` lists the grounds it is made on (`grass`,
`sand`, `stone`, `water`, `built`).

**`effects`**: the creature's own. An effect named in `cues` is looked for here first, then in the shared library,
[`core/details/effects.json`](core/details/effects.json): `dust_ring`, `scuff`, `sand_kick`, `grit`,
`splash_drops`, `splash_ring`. Use those for dust and water; make your own for what comes off your creature. The
library also holds what burns (`blast_*`, `scorch`, `launch_flash`, `backblast*`), which
[blasts.ts](../../client/core/render/blasts.ts) asks for by name with no creature and no cue.

| Field | Meaning |
| --- | --- |
| `pictures` | the pictures, one picked for each particle |
| `count`, `life`, `size`, `speed` | a number or `[least, most]`; size is metres across the picture's square |
| `shape` | `"point"`, `{ "sphere": r }`, `{ "ring": r }` or `{ "disc": r }`, metres at full size |
| `up` | the share of the speed pointed up; the rest is outward |
| `grow`, `fade` | how much larger it ends, and the seconds of its end it fades over |
| `drag`, `gravity`, `fall`, `wind` | how fast its speed comes to the wind's, the share of gravity, the fastest it falls, the share of the wind |
| `flutter` | `{ "sway", "hz", "rock", "turn" }`: a falling feather's sway, rocking and turning |
| `settle` | seconds it lies where it lands; without it, it never lands |
| `colour` | `"body"` (the picture's regions take the body's dyes), `"ground"`, or `[r, g, b]`; `vary` shades each |
| `face` | `free` (a card that tumbles), `camera` (a puff), `flat` (lying on the ground or water), `streak` (drawn out along the way it flies) |
| `pass` | `cutout` (solid: feathers, scales, chips) or `blend` (soft: dust, spray) |
| `lit`, `reach` | lit by the sun and sky, and the metres from the eye past which it is not made (40) |
| `opacity` | the most of it that shows, 0 to 1 (1): smoke that must never hide what is behind it whole |
| `glow` | above 0 it is light with no surface: a soft disc of its colour, that many times as bright, added over what is behind it; over 2 it blooms on high and ultra |
| `thick` | a thick puff of smoke worked out with no picture, lit as any puff, for smoke a wisp of dust is too thin for |
| `stain` | a dark soft disc on the ground that takes light and gives none: a scorch |

An effect with `glow`, `thick` or `stain` reads no picture, and still names one.

**`pictures`**: each `file` and its `regions`, and the `flat` shape low poly draws in its place: `feather`, `puff`,
`drop`, `ring` or `grain`.

## The pictures

- Square, 1024 pixels (512 at least), RGBA, the subject centred with at least 6% clear on every edge. The engine keeps
  each at 128 pixels in one atlas: judge yours at 128 and at 32.
- A long thing (a feather, a scale) lies along the picture's height, its base at the bottom.
- As a creature's own textures: light grey where it takes the body's colour, carrying only light and dark, and a
  `_regions.png` beside it in the region colours (red region 0, yellow region 5, black never dyed). At most two regions.
  A picture with no regions takes the effect's colour whole: dust and water are near-white grey.
- Alpha is coverage. Soft for a puff, falling to nothing well inside the edge; crisp for a cut-out.
- Keep the brief, the pictures at full size, the scripts that made them and a preview in the folder.

## Build it and look at it

```
bun run art -- core:details                                      the atlas, the effects and every sheet, into core/details/details.snpk
bun run snap -- --details land --graphics medium                 a landing as frames, from 3 m and 20 m at a phone's size
bun run snap -- --details down --graphics lowpoly --zoom 3       closer, on low poly
```

`--details` takes `land`, `thrown`, `struck`, `down`, `death`, `up`, `splash`, `flock` (forty landing) and `fight`
(a hundred going down). A test fails while `details.snpk` is older than its sheets and pictures.

## The bar and the budget

Seen in play it reads at 3 m and at 20 m, never looks like a square, and ends without anyone noticing. Keep bursts
small: the dodo's landing is 3 to 5 feathers and 4 to 6 puffs. A medium client keeps 1,536 particles alive at most and
covers at most one screen with see-through dust; past that, far bursts are thinned first and feathers on the ground
lie for less. Solid bits are cut out; only what is soft is see-through.
