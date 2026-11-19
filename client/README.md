# Client

Zones with hard lines between them.

| Zone | May use | Contents |
| --- | --- | --- |
| `core/` | ECMAScript, `shared`, `content` | `session.ts` (handshake, input, prediction, reconciliation, interpolation), `render/` (camera, terrain selection, structure batches, frame packet), `hud.ts` (HUD model, minimap), `selfcheck.ts` |
| `sound/` | DOM, Web Audio, and `core` | `sound.ts` (the page's audio context, and each frame's sound packet played), `board.ts` and `sounds.html` (the sound board, an admin's page that `server/sound-board.ts` serves) |
| `admin/` | DOM, Canvas 2D, and `core` | `admin.html` and `admin.ts` (the admin page, `/admin/`, that `server/admin/routes.ts` serves: health, survivors and a live map), `map.ts`, `history.ts` (the timeline over the survivor log, and a survivor's log), `charts.ts`, `dom.ts`; its logic is `core/admin/` |
| `voice/` | DOM, Web Audio, WebCodecs, and `core` | `voice.ts` (the microphone, on the page's audio context), `voice-worker.ts` (the voice socket, Opus encode and decode), `voice-capture.ts` and `voice-playback.ts` (audio worklets) |
| `city/` | DOM, and `core` | `maker.ts` and `city-worker.ts` (the far city's levels, made on a worker of their own: `core/render/citymake.ts`) |
| `shell/` | DOM, WebGL2, WebSocket, `core`, `voice`, `sound` and `city` | `gl.ts` (executes frame packets), `input.ts`, `socket.ts`, `hud.ts` (DOM binding), `main.ts` |

`core` is tested in Bun and never names a DOM type; its type check enforces
that. `shell`, `voice`, `sound` and `admin` have no tests and are limited to 1,600, 600,
300 and 1,100 lines by `tools/check.ts`. When something in one needs a test, move it into
`core`.

Play by touch is decided in core too: `core/touch.ts` (two zones and a few buttons, turned into the keys and looks
a keyboard sends) and `core/ui/touch.ts` (where they stand); the shell only holds a pointer to a control and forwards it.

`index.html` is the page. `bun run build` writes `client/dist`.

See [rendering](../planning/architecture/rendering.md),
[networking](../planning/architecture/networking.md),
[voice](../planning/architecture/voice.md), [sound](../planning/architecture/sound.md), and the
[testing policy](../planning/quality/testing.md).
