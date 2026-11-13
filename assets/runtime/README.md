# Runtime assets

Store reviewed, browser-ready exports and their manifest data here. Commit
intentional exports with their editable source; temporary build output belongs
outside this directory.

Consumers may use browser capabilities and the project's own loaders. No
third-party runtime decoder or hosted asset service is implied. Record bounds,
collision associations, LOD references, and actual resource costs according to
the [handoff contract](../../planning/architecture/contracts.md).

First prove one small asset loads by stable ID with no broken references.
No exports or manifest format exist yet.
