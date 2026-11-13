# Client

The browser client owns rendering, input, camera, UI, audio, asset loading,
prediction, and interpolation. The server decides authoritative gameplay state.

Use TypeScript compiled by Bun, native browser APIs, portable shared modules,
content definitions, and runtime assets. Do not import Bun APIs, server modules,
or third-party runtime packages. Start with a small WebGL2 scene and two connected
player markers.

See the [client workstream](../planning/workstreams/client.md),
[rendering plan](../planning/architecture/rendering.md), and
[browser checks](../planning/quality/browsers.md). This directory has no runnable
client yet.
