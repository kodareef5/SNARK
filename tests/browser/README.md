# Browser tests

Use pinned development-only Playwright tooling against the actual compiled
browser client and Bun server. Verify visible WebGL2 geometry, real input,
two independent sessions, and authoritative state synchronization in R1.

Use Chrome as the main smoke target and Firefox/WebKit for applicable
compatibility checks. Device emulation does not replace real iOS or Android
results. Collect relevant logs, screenshots, and traces on failure outside Git.

See the [browser matrix](../../planning/quality/browsers.md) and
[testing policy](../../planning/quality/testing.md). No runner or tests exist yet.
