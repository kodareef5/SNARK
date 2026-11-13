# Client

Two zones with a hard line between them.

| Zone | May use | Contents |
| --- | --- | --- |
| `core/` | ECMAScript, `shared`, `content` | `session.ts` (handshake, input, prediction, reconciliation, interpolation), `render/` (camera, terrain selection, structure batches, frame packet), `hud.ts` (HUD model, minimap), `selfcheck.ts` |
| `shell/` | DOM, WebGL2, WebSocket, and `core` | `gl.ts` (executes frame packets), `input.ts`, `socket.ts`, `hud.ts` (DOM binding), `main.ts` |

`core` is tested in Bun and never names a DOM type; its type check enforces
that. `shell` has no tests and is limited to 900 lines by `tools/check.ts`. When
something in the shell needs a test, move it into `core`.

`index.html` is the page. `bun run build` writes `client/dist`.

See [rendering](../planning/architecture/rendering.md),
[networking](../planning/architecture/networking.md), and the
[testing policy](../planning/quality/testing.md).
