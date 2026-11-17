# Unit tests

| File | Holds |
| --- | --- |
| `codec.test.ts`, `protocol.test.ts` | Bit codec round trips; malformed input is flagged, not thrown; every message's layout |
| `latency.test.ts` | Views with a round trip between a snapshot and its acknowledgement: a body that had to wait stays as the client last had it, a lost baseline, and a link that loses and delays held to the true states |
| `foundation.test.ts` | Deterministic trigonometry, identities, content hash, loopback ordering and loss |
| `world.test.ts`, `ray.test.ts`, `nodes.test.ts` | Terrain continuity, structure tables, the collision grid and rays against brute force, resource nodes as a function |
| `path.test.ts` | Ways across the ground: round a wall, never through a thin one, the search's budget, a search spread over calls, legs, a doorway off the grid, and a body walking every way found on the proving ground |
| `layers.test.ts` | Ways that climb and swim: up stairs onto a slab, a stair core of three storeys and down again rather than falling, the pool swum or waded round, a goal inside a pillar |
| `bodies.test.ts` | The grid of awake bodies that creatures search for prey |
| `mapfile.test.ts`, `maplayers.test.ts` | A map through its file and back, every height, tint, static in its slot, node slot and water square; each part read alone given its head; a part damaged or another's refused with its name, and a damaged or unplayable map with its reason; a map widened keeping the parts it did not reach; every node slot of hills with water, cliffs and footings as the rule had it before files said it, and right with every height but one sector's poisoned; each sector's statics set into the head's table in any order; overviews' tops equal to the server's bake; a folder of layers built into a map and unpacked again |
| `mapload.test.ts` | The page's map in parts: its head, land and overviews first; nothing more until it knows where the body is; the sectors within reach of the body alone, counted bytes and requests before the first frame, as the build's rule names them; the rest nearest first, six at once, ordered again after a jump; the statics once all the ground has come; a part failing once, three times or for good, before the first frame or after, near or behind, ground or statics, asked for again with the waits counted, and the statics handed over whole; a failed sector asked for again in its turn by distance; damaged parts refused by name, asked for again, and the third time the map broken; what the player is told; a listed layer's map brought whole; parts late and scrambled under a drawing scene, never a sample not set, ending in the whole map's picture |
| `staged.test.ts` | A client's ground as it comes in parts: every sample its overview's until its sector comes, in any order, then the map's own; which chunks hold their own; what is made of the ground made again where it changed, the window within the frame's allowance, until the picture is that of the map held whole; a sector's piece let go once copied, a listed layer's rows kept alone |
| `character.test.ts`, `swim.test.ts` | Movement rules and the anti-clipping fuzz tests, on land and in water |
| `sim.test.ts`, `items.test.ts` | Deadlines, lazy quantities, stat points, inheritance statistics; inventories |
| `weapon.test.ts`, `anim.test.ts`, `creature.test.ts` | The action step; skeletons, clips, poses and hit zones for survivors and for creatures that came as models |
| `taming.test.ts`, `breeding.test.ts`, `station.test.ts` | The reference's taming table; litters and growing up by hundredths; a fire worked out from the last time anyone looked |
| `dodo.test.ts` | The dodo against the ARK wiki: stats, speeds, its taming table level by level, torpor, breeding times, colour regions; its peck, head zones and size against its model |
| `building.test.ts`, `snap.test.ts`, `support.test.ts`, `collapse.test.ts` | Pieces made of boxes; where pieces go; the reference's support table; a collapse against brute force |
| `joins.test.ts`, `pushorder.test.ts`, `swapfall.test.ts` | Joined pieces meet for every ray and every body at every turn; a body is pushed out of pieces in one order wherever they are stored; a piece that changes kind during a collapse is still judged |
| `voice.test.ts` | Voice packets, the jitter buffer against scripted arrivals, the rate changer, the talk gate |
| `packs.test.ts`, `pack.test.ts` | Content pack stacking and its error reports; glTF import and the asset pack format |
| `build.test.ts` | The client build's Brotli copies, best and quick |
| `render.test.ts` | Frame packets through the software rasterizer, asserted per pixel |
| `views.test.ts` | What artists look at: a snapshot on a graphics tier with textures, the textures kept between runs, and a sheet with materials |
| `hud.test.ts`, `ui.test.ts` | The HUD model, the minimap, the self-check logic; every screen laid out at four window shapes |
| `tactical.test.ts`, `map.test.ts` | Latitude and longitude from the display origin, and shares of the map's picture; a chunk's structures baked to cells against brute force, and on the wire; marks; the map's tiles and its four zooms lining up; a map of 12 by 8 km shown in its own proportions; a widened map reading the same coordinates with its grid on the same ground |
| `contracts.test.ts` | What the creature packages build on: the cue word's lasting states, hurt stages, the new codes, columns that change nothing until used, the dodo's numbers, its egg item and the tames' levels ready to join |

Assert observable outcomes. Prefer a property over many seeded inputs to a few
hand-picked cases when the rule is an invariant.
