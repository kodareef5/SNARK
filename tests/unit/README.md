# Unit tests

| File | Holds |
| --- | --- |
| `codec.test.ts` | Bit codec round trips; malformed input is flagged, not thrown |
| `foundation.test.ts` | Deterministic trigonometry, identities, content hash, loopback ordering and loss |
| `world.test.ts` | Terrain continuity, structure tables, collision grid against brute force |
| `character.test.ts` | Movement rules and the anti-clipping fuzz tests |
| `sim.test.ts` | Deadlines, lazy quantities, stat points, breeding statistics |
| `packs.test.ts` | Content pack stacking and its error reports |
| `pack.test.ts` | glTF import and the asset pack format |
| `render.test.ts` | Frame packets through the software rasterizer, asserted per pixel |
| `hud.test.ts` | HUD model, minimap image, self-check probe logic |

Assert observable outcomes. Prefer a property over many seeded inputs to a few
hand-picked cases when the rule is an invariant.
