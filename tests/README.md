# Tests

This directory reserves locations for executable behavioral tests. It currently
contains documentation only. No automated game test has run or passed.

| Directory | Purpose |
| --- | --- |
| [Unit](unit/README.md) | Pure gameplay and protocol behavior |
| [Integration](integration/README.md) | Real server, persistence, and boundary failures |
| [Browser](browser/README.md) | Real browser client/server scenarios |
| [Performance](performance/README.md) | Reproducible measured workloads |
| [Fixtures](fixtures/README.md) | Small deterministic inputs and builders |

Use Bun tests and development-only browser tooling. Keep temporary databases,
failure traces, screenshots, logs, and reports out of Git. Begin with the R1
scene, two-client synchronization, and invalid-command regression.

See [testing policy](../planning/quality/testing.md) for required checks and
[quality plans](../planning/quality/README.md) for coverage.
