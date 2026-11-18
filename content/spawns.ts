import type { Def } from "../shared/content/defs.ts";

// Spawn tables. ARK's are its, at 1x, as the wiki's Spawn entries page and the data it is made from (arkutils Obelisk,
// spawn_groups.json for ARK: Survival Evolved 358.3) gave them on 2026-11-14. ARK writes offsets in centimetres along its
// x and y; here they are metres along x and z. A table keeps only the entries of creatures this build has.

const dodo = "core:dodo";
const para = "core:parasaur";
const raptor = "core:raptor";
const carbonemys = "core:carbonemys";
const rex = "core:rex";
const ptera = "core:pteranodon";
const trike = "core:trike";
const stego = "core:stego";

export const SPAWNS: readonly Def[] = [
  // The Island's beach groups for the available native species.
  {
    type: "spawns",
    id: "core:spawns_beach",
    entries: [
      { name: "Dodo Spawn (1-5)", weight: 0.425, group: [dodo, dodo, dodo, dodo, dodo], chances: [1, 0.7, 0.6, 0.25, 0.2], offsets: [[0, 6.8], [0, 0], [0, -6.8], [0, -3.4], [0, 3.4]] },
      { name: "Para (1-2)", weight: 0.125, group: [para, para], chances: [1, 0.5], offsets: [[0, 6.8], [0, -6.8]] },
      { name: "Ptero (1-2)", weight: 0.15, group: [ptera, ptera], chances: [1, 0.5], offsets: [[0, 2.5], [0, -2.5]] },
      { name: "Trike (1-2)", weight: 0.1, group: [trike, trike], chances: [1, 0.5], offsets: [[0, 6.8], [0, -6.8]] },
      { name: "Shore turtles", weight: 0.14, group: [carbonemys, carbonemys], chances: [1, 0.45], offsets: [[0, 0], [5, -3]] },
    ],
    limits: [{ species: dodo, share: 0.6 }, { species: para, share: 0.2 }, { species: ptera, share: 0.25 }, { species: trike, share: 0.2 }, { species: carbonemys, share: 0.20 }],
  },
  // The jungle species inhabit Miami's hammocks, gardens and ruins.
  {
    type: "spawns",
    id: "core:spawns_jungle",
    entries: [
      { name: "Para (1-3)", weight: 0.2, group: [para, para, para], chances: [1, 0.6, 0.3], offsets: [[0, 0], [0, 6.8], [0, -6.8]] },
      { name: "Raptor (1-2)", weight: 0.13, group: [raptor, raptor], chances: [1, 0.5], offsets: [[0, -2.5], [0, 2.5]] },
      // The original group label says 1–3, while its data defines two members.
      { name: "Trike (1-3)", weight: 0.075, group: [trike, trike], chances: [1, 0.6], offsets: [[0, 0], [0, 6.8]] },
      { name: "Stego (1-2)", weight: 0.025, group: [stego, stego], chances: [1, 0.5], offsets: [[0, 6.8], [0, -6.8]] },
      { name: "Solitary Rex", weight: 0.018, group: [rex] },
    ],
    limits: [{ species: trike, share: 0.15 }, { species: stego, share: 0.1 }, { species: rex, share: 0.06 }],
  },
  // The proving ground's herd and hunters, each one species, in the groups ARK's jungle gives them.
  { type: "spawns", id: "core:spawns_proving_herd", entries: [{ name: "Para (1-3)", weight: 0.2, group: [para, para, para], chances: [1, 0.6, 0.3], offsets: [[0, 0], [0, 6.8], [0, -6.8]] }] },
  { type: "spawns", id: "core:spawns_proving_hunters", entries: [{ name: "Raptor (1-2)", weight: 0.13, group: [raptor, raptor], chances: [1, 0.5], offsets: [[0, -2.5], [0, 2.5]] }] },
];
