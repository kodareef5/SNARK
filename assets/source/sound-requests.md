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
| `core:survivor/sound/glider/open` | A frond glider thrown open over the head (cue `glider/open`): dry palm fronds snapping taut on two sticks, a rattle and a soft whump, no cloth | 0.4 to 0.8 s, once; 4 takes | `core:movement/sound/parachute`, which it plays now | 2026-11-21, the glider |
| `core:survivor/sound/glider/fold` | The glider folded in the air or on landing (cue `glider/fold`): fronds clattering shut along the sticks | 0.3 to 0.6 s, once; 3 takes | `core:movement/sound/parachute` played faster, which it plays now | 2026-11-21, the glider |
| `core:world/sound/glider/air` | The air over the player's own glider (cue `glider/air`), its level following speed: wind through dry fronds with a creak of lashed wood now and then, no gusts that would mark the loop | 8 to 12 s, loop | `core:movement/sound/fall`, which it plays now | 2026-11-21, the glider |
| `core:zephyr/sound/thruster/burst` | A thruster car's flip (cue `vehicle/thruster/burst`): a sharp blast of compressed air from four nozzles under the car, a hard "pssh-THUMP" with no flame and no ignition, then the hiss trailing off | 0.5 to 1 s, once; 4 takes | `core:supply/sound/ignite`, which it plays now | 2026-11-22, the Zephyr |
| `core:zephyr/sound/thruster/boost` | A thruster car's boost (cue `vehicle/thruster/boost`): compressed air roaring from two tail nozzles at full pressure, a broad white hiss with a low rumble, no combustion crackle | 3 to 6 s, loop | `core:supply/sound/jet`, which it plays now | 2026-11-22, the Zephyr |
