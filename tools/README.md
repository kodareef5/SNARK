# Development tools

Keep Bun build scripts, asset conversion helpers, local development tools, and
verification utilities here as actual workflows need them.

Tools may use pinned development dependencies. They must not enter client or
server runtime imports. Prefer built-in Bun capabilities and record any external
authoring-tool requirement.

The first runnable PR adds build and verification commands with CI.
See [integration](../planning/workstreams/integration.md) and
[testing policy](../planning/quality/testing.md). No commands are implemented yet.
