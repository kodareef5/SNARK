# Gameplay content

Keep immutable gameplay definitions for species, items, recipes, structures,
resources, and maps here. Stable content IDs connect simulation rules and assets.

Definitions are data. Shared contracts validate them before runtime; core systems
should not require a creature or item name. No arbitrary third-party scripts or
runtime dependencies are implied by a content pack.

Begin with the definitions needed by the first scene and survival slice.
See [entities and content](../planning/architecture/entities.md) and the
[art/content workstream](../planning/workstreams/art-content.md). No schema or
content pack is implemented yet.
