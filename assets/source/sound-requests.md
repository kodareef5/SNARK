# Sound requests

Sounds the game wants and does not have, or wants replaced. How they are made is in
[`tools/sound/README.md`](../../tools/sound/README.md).

- **To ask:** add a row here in your own branch, one sound a row, named as the game looks it up
  (`<owner>/sound/<name>`). A replacement names the sound it replaces and says why. With the art installed
  (`bun run media art`), `bun run sounds` lists the occasions the game fires that no sound answers.
- **To answer:** make the takes on a branch of your own (`tools/sound/README.md`, "Making sounds" and "Shipping
  takes"), and delete the row in that branch.

| Sound | For | Length, loop | Nearest that exists | Asked |
| --- | --- | --- | --- | --- |
| `core:ui/sound/notice` | A notice arrives in the interface (cue `notice`; its brief slot has no take). The catalogue counts it fired, but nothing in the client fires it yet | 0.2 to 0.5 s, once; 2 takes | `core:ui/sound/chat` | 2026-11-16, performance review |
| `core:body/sound/rustle/foliage` | Any body pushing through a bush (cue `rustle`); its brief slot has no take. The catalogue counts it fired, but nothing in the client fires it yet | 0.4 to 1 s, once; 4 takes | `core:node/sound/picked/foliage` | 2026-11-16, performance review |
| `core:dodo/sound/chase` | A running dodo's flustered call every 1.2 to 3.5 s as it flees (cue `chase`) | 0.3 to 0.8 s, once; 4 takes | `core:dodo/sound/startled` | 2026-11-16, performance review |
| `core:vehicle/sound/tire/skid/dirt` | The car's wheels sliding on dirt; it would fall back to the asphalt squeal | 1 to 2.5 s, once; 2 takes | `core:vehicle/sound/tire/skid/gravel` | 2026-11-16, performance review |
| `core:vehicle/sound/tire/skid/grass` | The car's wheels sliding on grass | 1 to 2.5 s, once; 2 takes | `core:vehicle/sound/tire/skid/gravel` | 2026-11-16, performance review |
| `core:vehicle/sound/tire/skid/mud` | The car's wheels sliding in mud | 1 to 2.5 s, once; 2 takes | `core:vehicle/sound/tire/skid/gravel` | 2026-11-16, performance review |
| `core:vehicle/sound/tire/skid/sand` | The car's wheels sliding on sand | 1 to 2.5 s, once; 2 takes | `core:vehicle/sound/tire/skid/gravel` | 2026-11-16, performance review |
