# Accepted native helicopter art review

These images use the game's renderer, palette, material mips and actual body meshes. The Blender/concept studies beside this folder document the design process; these native images are the production review.

- `hero.png`, `hero_rescue.png`, `hero_police.png`, `hero_wreck.png`: complete exterior, three liveries and attached crushed/bent wreck hardware. Police lettering has dark ink on its pale stripe.
- `views.png`, `levels.png`: complete native angle and distance review. Both blade assemblies survive all six levels. The final per-variant triangle counts are recorded below.
- `driver.png`: clear forward cockpit view and matte printed reference panels. FLIGHT REF and SERVICE REF are static artwork; actual telemetry belongs to the live HUD.
- `occupied_*_doors_open.png`, `occupied_*_controls.png`: real large/small male and female bodies in all four seats, wearing hide armor. Pilot arms use the same actual-scale control solve as the game.
- `occupied_*_pilot_forward.png`, `occupied_*_pilot_controls.png`: actual scaled human eye socket, visible body and hands, with only the pilot's own head suppressed as in a first-person camera.
- `stages_side.png`, `stages_rescue.png`, `stages_police.png`: intact, three hurt states and three decay states. The dedicated wreck has bent blades, a sagged tail, a crushed bow/cowling and buckled doors, on the same eight-bone rig.
- `check*.json`: zero native faults across all four final packs: no holes, reversed edges, inward components or shared mirrored UV wedges; all declared geometry and material budgets pass.

Final triangle counts (the livery palettes can produce slightly different flat-level reductions):

| Variant | LOD 0 | LOD 1 | LOD 2 | LOD 3 | LOD 4 | LOD 5 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Civilian | 34208 | 18000 | 7000 | 2598 | 998 | 480 |
| Rescue | 34208 | 18000 | 7000 | 2598 | 998 | 480 |
| Police | 34208 | 18000 | 7000 | 2600 | 998 | 478 |
| Wreck | 34208 | 18000 | 7000 | 2600 | 1000 | 478 |

The final fit report is `../fit-bounds.json`: 30,768,944 tested geometry points, 9,216 pilot profiles. Independent scale intervals cover continuous body/leg/passenger-arm ranges; an angular allowance covers continuous head look. The nonlinear pilot arm solve is checked at all 8,192 combined arm/torso proportion extrema and 1,024 interior samples across both sexes. Minimum body clearance is 59.5 mm; head clearance after the continuous-look allowance is 89.3 mm; pilot arm/hand clearance is 310.9 mm. All actual grips land within 0.001 mm of their control targets. Every armor, hair and beard mesh in the native human pack is included.

Validation: all four `bun run art` builds/checks pass, tools and shared TypeScript checks pass, and 24 focused native art, control-pose, surface and simplifier tests pass (7,061 assertions). An in-memory `repack --levels` check also retains both rotors and closed outward topology at every level.

Reproduce with:

```sh
bun run art -- core:helicopter core:helicopter_rescue core:helicopter_police core:helicopter_wreck
bun assets/source/core/vehicles/helicopter/ref/fit.ts --bounds --controls --write
bun assets/source/core/vehicles/helicopter/ref/occupied.ts --out artifacts/helicopter-review
bun assets/source/core/vehicles/helicopter/tex/look.ts --out artifacts/helicopter-review/civilian
bun assets/source/core/vehicles/helicopter/tex/look.ts --asset core:helicopter_rescue --out artifacts/helicopter-review/rescue
bun assets/source/core/vehicles/helicopter/tex/look.ts --asset core:helicopter_police --out artifacts/helicopter-review/police
bun assets/source/core/vehicles/helicopter/tex/look.ts --asset core:helicopter_wreck --out artifacts/helicopter-review/wreck
```

## On main

`main/` holds five of the twelve views `bun tools/helicopter/review.ts` made on
`r9/helicopter-land` (2026-11-16), after the merge onto main: the civilian aircraft
with four seated, the pilot's cockpit with main's glass instruments, banked and
inverted flight, and the inverted wreck. All twelve kept four seated where seated,
with no dropped or skipped draws. The ground is main's world surfaces' paving.
