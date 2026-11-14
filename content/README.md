# Gameplay content

Immutable definitions for species, items, and structures, as TypeScript data.
`core.ts` holds the core pack: the survivor, a placeholder grazer, the graybox
structures of the proving ground, and two items.

Every definition is of a class. The classes, what each must and may declare,
and the core pack by class are in the generated
[catalogue](../planning/reference/catalogue.md).

A definition has a stable id of the form `namespace:name`. Systems read numbers
from the compiled registry; none branches on an id.

Packs stack. A later pack may extend a definition, define templates, or override
a field of an earlier pack's definition, and may define ids only in its own
namespace. See `shared/content/packs.ts` and the
[gameplay data model](../planning/architecture/gameplay-model.md).

A definition's `mesh` is `box` (a graybox generated from its collider) or the id
of a mesh in an asset pack. Colors are palette indices
(`shared/pack/palette.ts`).

Content imports only types from `shared`. No scripts, no packages.
