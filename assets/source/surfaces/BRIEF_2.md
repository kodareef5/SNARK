# World surfaces, round one, continued: the real GPU's verdict

Your round one is committed on `r9/surfaces` (aa163630). Main has since been merged in (0fa23718), and it brings a reworked test gate:
- there is no wall-clock budget; the fast tier is held to 440 CPU-seconds;
- every test has one hang limit, `hungAfter`, and no test may carry its own timeout number;
- a slow tier holds files named `*.slow.test.ts`; the two 20-minute flyer runs moved there.

Your socket and flyer failures were sandbox and load effects. Outside the sandbox, the flyer files pass in 17 s. The coordinator ran the check and the browser probe outside your sandbox.

## What the real GPU said
`bun run probe` on the Apple M5 (Chrome, ANGLE Metal) **failed**. The shaders compiled and drew with no errors, and three of the six pixel probes failed. The full output is in `evidence/gpu-probe-1.json.txt`. The probes are in `client/core/selfcheck.ts`; each holds the GPU's pixel to a TypeScript twin of the shading.

| Probe | Twin expected | GPU drew | Result |
|---|---|---|---|
| sky | 90, 146, 211 | 90, 146, 211 | ok |
| plaza (ground) | 177, 179, 177 | 126, 126, 122 | ok, within the lit tolerance |
| block (a static's south face) | 74, 84, 97 | 50, 55, 59 | fail |
| slope (the ground on a hill) | 149, 93, 61 | 66, 77, 45 | fail |
| creature (the grazer, any facing) | 118, 120, 60 | 98, 95, 65 | fail |
| body (the survivor's chest) | 108, 92, 79 | 108, 92, 79 | ok |

## What to do
1. **The twins must know the surfaces.** `selfcheck.ts`'s `color()` and the probes' expected values come from the old flat palette shading. On the lit tiers, a static and the ground now carry a finish. Make the twins shade with your own CPU surface path (`world-surfaces.ts`), so the probe holds the GPU to the same picture the software rasterizer draws, at those exact pixels. Do not loosen the tolerance.
2. **Explain the creature.** This round should not change the grazer: it is a species, drawn with palette shading. Yet it is darker and greener-shifted on the GPU against a twin that passed on main (the sound merge's probe passed all six). Your report says "fully rough plain draws avoid the extra sky reflection lookup".
   - If that change altered how plain lit draws are lit, either make the twin match it, or undo it if it was not meant to change a creature's look.
   - If something else is going on (the grazer standing on or before a surfaced patch, a uniform or texture unit clash between the world-surface atlas and the creature's draw), find it and fix it.
   - Say which, with evidence.
3. **Slope and block may show a real mismatch** between your GLSL and your TypeScript, not only stale twins. A dark, desaturated block (50, 55, 59) and a green-brown slope (66, 77, 45) should be what your CPU path gives at those points with the plaza's lighting. Show that it does.

You can't run Chrome in your sandbox. Make the changes, run `bun run check` for what it can tell you, and say what the coordinator should run. The coordinator will run the probe and send the results back. If you can add a software-side test that computes the twin for these probes from the same scene and compares it with the software rasterizer, do. That catches drift without a GPU.

Add a short "Round one, continued" section to `REPORT.md`. You can't commit; leave the work in the tree.
