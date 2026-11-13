# Client

Three zones with hard lines between them.

| Zone | May use | Contents |
| --- | --- | --- |
| `core/` | ECMAScript, `shared`, `content` | `session.ts` (handshake, input, prediction, reconciliation, interpolation), `render/` (camera, terrain selection, structure batches, frame packet), `hud.ts` (HUD model, minimap), `selfcheck.ts` |
| `voice/` | DOM, Web Audio, WebCodecs, and `core` | `voice.ts` (the audio context and the microphone), `voice-worker.ts` (the voice socket, Opus encode and decode), `voice-capture.ts` and `voice-playback.ts` (audio worklets) |
| `shell/` | DOM, WebGL2, WebSocket, `core` and `voice` | `gl.ts` (executes frame packets), `input.ts`, `socket.ts`, `hud.ts` (DOM binding), `main.ts` |

`core` is tested in Bun and never names a DOM type; its type check enforces
that. `shell` and `voice` have no tests and are limited to 900 and 600 lines by
`tools/check.ts`. When something in either needs a test, move it into `core`.

`index.html` is the page. `bun run build` writes `client/dist`.

See [rendering](../planning/architecture/rendering.md),
[networking](../planning/architecture/networking.md),
[voice](../planning/architecture/voice.md), and the
[testing policy](../planning/quality/testing.md).
