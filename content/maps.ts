import type { Def } from "../shared/content/defs.ts";

// Worlds. A map's ground, nodes, spawn points and spawn regions are its file (planning/reference/maps.md); Miami's is
// built by `bun tools/mapworld/build.ts miami` from assets/source/maps/miami.
export const MAPS: readonly Def[] = [{ type: "map", id: "core:miami", label: "Miami", chunks: [127, 127], seaLevel: 0 }];
