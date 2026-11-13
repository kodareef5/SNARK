# Integration tests

Exercise the real Bun server and its boundaries: connections, command rejection,
SQLite transactions, conservation, restart, and recovery. Use temporary databases,
isolated configuration, and clean teardown.

Tests may use built-in Bun APIs and production/shared modules. Begin with two
connections and invalid input, then add durability cases in R2. No production
secrets or live world data belong in fixtures.

See [testing policy](../../planning/quality/testing.md). No tests are implemented yet.
