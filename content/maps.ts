import type { Def } from "../shared/content/defs.ts";

// Worlds. A map's ground, nodes, spawn points and spawn regions are its file (planning/reference/maps.md); each is built
// by `bun tools/mapworld/build.ts <name>` from assets/source/maps/<name>.
export const MAPS: readonly Def[] = [
  { type: "map", id: "core:miami", label: "Miami", chunks: [127, 127], seaLevel: 0 },
  { type: "map", id: "core:tampa", label: "Tampa", chunks: [127, 127], seaLevel: 0 },
  { type: "map", id: "core:san-francisco", label: "San Francisco", chunks: [127, 127], seaLevel: 0 },
  // No sea in its frame: its ground stands 47 to 555 m over the sea, which is the map's zero.
  { type: "map", id: "core:los-angeles", label: "Los Angeles", chunks: [127, 127] },
];
