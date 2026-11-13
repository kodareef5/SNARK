# Assets

Original editable art goes in [source](source/README.md). Nothing is committed
there yet: the proving ground uses graybox meshes generated from content
definitions.

The pipeline: a glTF binary export in `assets/source/<pack>/<name>.glb` becomes
the mesh `<pack>:<name>` in a pack file when `bun tools/pack/build.ts` or
`bun run build` runs. The pack format, palette, and export conventions are in
[rendering](../planning/architecture/rendering.md) and
[contracts](../planning/architecture/contracts.md).

Agree on per-device budgets before bulk production. A storage policy for large
binaries is not decided.
