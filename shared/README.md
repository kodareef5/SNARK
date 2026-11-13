# Shared code

Keep portable TypeScript contracts and pure logic used by both browser and server
here. Candidates include identity and protocol types, math, movement rules,
content contracts, and validation that both sides need.

Shared modules must not import client, server, tools, tests, DOM, or Bun-specific
APIs. No third-party runtime packages. Pass environmental inputs explicitly.
Do not move code here solely because it might be reused later.

First agree on identity, coordinates, commands, snapshots, and movement boundaries
through the [integration contracts](../planning/architecture/contracts.md).
Add concrete types with implementation fixtures and tests. No public types or
wire formats exist yet.
