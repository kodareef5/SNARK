import type { StructureDef } from "../shared/content/defs.ts";

// Where a survivor leaves for another server of its cluster, as ARK's obelisks are: a tall obelisk seen from across the map,
// and at its foot the terminal a survivor walks up to and uses (planning/architecture/transfers.md). A map sets both down
// (shared/world/obelisks.ts); they belong to nobody, and with no material nothing harms them. Their meshes are stand-in boxes
// until the art replaces them under the same ids. A piece's origin is the middle of its box. A piece is at most 32 m tall, so
// the obelisk is three of its piece stacked, 90 m in all.
export const TERMINALS: readonly StructureDef[] = [
  { type: "structure", class: "static", id: "core:obelisk", mesh: "box", color: 11, half: [3, 15, 3], hp: 1000000 },
  { type: "structure", class: "static", id: "core:travel_terminal", mesh: "box", color: 8, half: [0.6, 0.6, 0.3], hp: 1000000 },
];
