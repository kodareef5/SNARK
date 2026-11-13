# Test fixtures

Keep small deterministic scene/content inputs and fixture builders here. Use
original test data, seeded randomness, and explicit clocks. Avoid real accounts,
secrets, large binaries, and copied production databases.

Fixtures may depend on portable project contracts and test tooling. Generate
SQLite databases in temporary storage. Shared geometric cases should exercise
the same coordinates and collision conventions in simulation and rendering.

First add a small scene for the two-client proof and invalid movement case.
See [testing policy](../../planning/quality/testing.md). No fixtures exist yet.
