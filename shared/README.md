# Shared code

Portable TypeScript used by the browser, the server, and tools. ECMAScript only:
no DOM, no Bun, no packages, no clock. Environmental inputs are passed in.

| Path | Contents |
| --- | --- |
| `coords.ts` | Axes, units, chunks, tick rate |
| `ids.ts` | Handles, persistent ids |
| `math/` | Trigonometry that is bit-identical on every engine |
| `rng.ts`, `hash.ts`, `sort.ts` | Seeded randomness, FNV hash, allocation-free sort |
| `world/` | Height grid, structure tables and collision grid, capsule collision, path finding, the map file, the proving ground |
| `sim/` | Entity store, character controller, deadlines, lazy quantities, genome |
| `net/` | Bit codec, protocol messages, entity views and deltas, transport interface, loopback |
| `content/` | Definition types, pack stacking, the compiled registry |
| `pack/` | Asset pack format and palette |
| `people/` | The person generator: a seed and a population make a person |
| `video/` | Clips, channels and what a screen plays: the programme and its message |

`sim/`, `world/`, and `math/` must produce identical bits on JavaScriptCore and
V8. `tools/check.ts` rejects `Math.sin` and similar there; use `math/scalar.ts`.

Do not move code here because it might be reused. Move it when both sides need
the same answer.

See the [architecture](../planning/architecture/README.md).
