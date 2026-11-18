import type { Def } from "../shared/content/defs.ts";

// Worlds, one a city. A map's ground, nodes, spawn points and spawn regions are its file (planning/reference/maps.md); each
// is built by `bun tools/maps/city.ts <name>` from what assets/source/maps/<name> holds (tools/maps/README.md).
export const MAPS: readonly Def[] = [
  { type: "map", id: "core:miami", label: "Miami", seaLevel: 0 },
  { type: "map", id: "core:tampa", label: "Tampa", seaLevel: 0 },
  { type: "map", id: "core:san-francisco", label: "San Francisco", seaLevel: 0 },
  // No sea in its frame: its ground stands 47 to 555 m over the sea, which is the map's zero.
  { type: "map", id: "core:los-angeles", label: "Los Angeles" },
  // No sea in its frame either: its ground stands 586 to 713 m over NAVD88.
  { type: "map", id: "core:las-vegas", label: "Las Vegas" },
];
