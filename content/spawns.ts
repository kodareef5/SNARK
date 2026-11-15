import type { Def } from "../shared/content/defs.ts";

// Spawn tables. ARK's are its, at 1x, as the wiki's Spawn entries page and the data it is made from (arkutils Obelisk,
// spawn_groups.json for ARK: Survival Evolved 358.3) gave them on 2026-11-14. ARK writes offsets in centimetres along its
// x and y; here they are metres along x and z. A table keeps only the entries of creatures this build has.

const dodo = "core:dodo";
const para = "core:parasaur";
const raptor = "core:raptor";

export const SPAWNS: readonly Def[] = [
  // The Island's beach. ARK's has eleven more entries, of species this build lacks, weighing 1.215 of its 1.765.
  {
    type: "spawns",
    id: "core:spawns_beach",
    entries: [
      { name: "Dodo Spawn (1-5)", weight: 0.425, group: [dodo, dodo, dodo, dodo, dodo], chances: [1, 0.7, 0.6, 0.25, 0.2], offsets: [[0, 6.8], [0, 0], [0, -6.8], [0, -3.4], [0, 3.4]] },
      { name: "Para (1-2)", weight: 0.125, group: [para, para], chances: [1, 0.5], offsets: [[0, 6.8], [0, -6.8]] },
    ],
    limits: [{ species: dodo, share: 0.6 }, { species: para, share: 0.2 }],
  },
  // ARK's jungle, keeping its parasaur and raptor groups: what lives in the hammocks, gardens and ruins of Miami.
  {
    type: "spawns",
    id: "core:spawns_jungle",
    entries: [
      { name: "Para (1-3)", weight: 0.2, group: [para, para, para], chances: [1, 0.6, 0.3], offsets: [[0, 0], [0, 6.8], [0, -6.8]] },
      { name: "Raptor (1-2)", weight: 0.13, group: [raptor, raptor], chances: [1, 0.5], offsets: [[0, -2.5], [0, 2.5]] },
    ],
  },
  // The proving ground's herd and hunters, each one species, in the groups ARK's jungle gives them.
  { type: "spawns", id: "core:spawns_proving_herd", entries: [{ name: "Para (1-3)", weight: 0.2, group: [para, para, para], chances: [1, 0.6, 0.3], offsets: [[0, 0], [0, 6.8], [0, -6.8]] }] },
  { type: "spawns", id: "core:spawns_proving_hunters", entries: [{ name: "Raptor (1-2)", weight: 0.13, group: [raptor, raptor], chances: [1, 0.5], offsets: [[0, -2.5], [0, 2.5]] }] },
];
