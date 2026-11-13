# Server

The Bun server owns simulation, command validation, connections, durable state,
and recovery. It is headless and must not depend on rendering or the DOM.

Use TypeScript, built-in Bun WebSockets and SQLite, portable shared modules,
and validated content. No third-party runtime packages. Start with one small
in-memory authoritative world and two client sessions, then add durable state
in R2.

See the [server workstream](../planning/workstreams/server.md),
[authority](../planning/architecture/authority.md), and
[persistence plan](../planning/architecture/persistence.md). No server or schema
is implemented yet.
