# Tampa on the round-four shared generator

Tampa now inherits the shared forms, choices, assemblies, street remnants, damage, interiors and growth rules. Its districts, recipes, four-million-piece budget, surge direction, two named compositions and sight corridors remain local. The copied rule sections were removed.

The [full round-four report](../../miami/ruins/REPORT_4.md) compares both cities, describes the library and its extension points, and records the engine asks and check limitations. [Counts](../reports/ruins4/generation.json), [growth](../reports/ruins4/growth.json), [pieces by kind before and after](../reports/ruins4/pieces-by-kind.csv), [verification](../reports/ruins4/verification.json) and [determinism](../reports/ruins4/determinism.json) are local evidence.

The final city has 2,271,129 statics, at most 984 in a chunk, 748,783 resource nodes, and 31,538 admitted building parts. Two fresh builds produce the same 91,200,019-byte map. All 1,745 stairs, 1,105 roof exits, 50,618 street approaches, 8,970 building circuits, 4,386 street-gap circuits, 576 deck runs and 290 swims pass. The three authored breaks remain open, and spawn walks pass. There are still 24 cores without a certified street approach; these are listed, not counted as passed routes.

The wet support test now checks the width of a street approach, resolving the Yard Offices water-edge failure. The shared circulation pass clears displaced floor plates from adjoining routes, resolving the earlier room failures. No test tolerance was loosened.

Build with `bun tools/mapworld/build.ts tampa`; verify with `bun tools/mapworld/verify.ts var/maps/tampa.snmap`. No new Tampa gallery is claimed. The complete picture review is the Miami gallery; the inherited methods are tested here in the packed Tampa map.
