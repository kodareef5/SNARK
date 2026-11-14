# Unit tests

| File | Holds |
| --- | --- |
| `codec.test.ts`, `protocol.test.ts` | Bit codec round trips; malformed input is flagged, not thrown; every message's layout |
| `foundation.test.ts` | Deterministic trigonometry, identities, content hash, loopback ordering and loss |
| `world.test.ts`, `ray.test.ts`, `nodes.test.ts` | Terrain continuity, structure tables, the collision grid and rays against brute force, resource nodes as a function |
| `mapfile.test.ts`, `maplayers.test.ts` | A map through its file and back; a damaged or unplayable one refused with its reason; a folder of layers built into a map and unpacked again |
| `character.test.ts`, `swim.test.ts` | Movement rules and the anti-clipping fuzz tests, on land and in water |
| `sim.test.ts`, `items.test.ts` | Deadlines, lazy quantities, stat points, inheritance statistics; inventories |
| `weapon.test.ts`, `anim.test.ts`, `creature.test.ts` | The action step; skeletons, clips, poses and hit zones for survivors and for creatures that came as models |
| `taming.test.ts`, `breeding.test.ts`, `station.test.ts` | The reference's taming table; litters and growing up by hundredths; a fire worked out from the last time anyone looked |
| `building.test.ts`, `snap.test.ts`, `support.test.ts`, `collapse.test.ts` | Pieces made of boxes; where pieces go; the reference's support table; a collapse against brute force |
| `voice.test.ts` | Voice packets, the jitter buffer against scripted arrivals, the rate changer, the talk gate |
| `packs.test.ts`, `pack.test.ts` | Content pack stacking and its error reports; glTF import and the asset pack format |
| `render.test.ts` | Frame packets through the software rasterizer, asserted per pixel |
| `hud.test.ts`, `ui.test.ts` | The HUD model, the minimap, the self-check logic; every screen laid out at four window shapes |

Assert observable outcomes. Prefer a property over many seeded inputs to a few
hand-picked cases when the rule is an invariant.
