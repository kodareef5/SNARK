// The library: layouts that show how bases are built here, to build as they are or to start a design from. Each is
// written as the Director would write one (grunt/layout.ts). The front is the south side by habit: a build turns it to
// face where it is asked. Add to it freely; tests compile every entry.

import type { Layout } from "./layout.ts";

export const BLUEPRINTS: Record<string, Layout> = {
  hut_2x2: {
    about: "The first shelter: one room, a door at the front. Any tier, thatch included.",
    rooms: [{ at: [0, 0], size: [2, 2], doors: ["s0"] }],
  },
  shed_2x1: {
    about: "A store for boxes: one narrow room with a door on its long side. Any tier.",
    rooms: [{ at: [0, 0], size: [2, 1], doors: ["s1"] }],
  },
  house_3x3: {
    about: "A home: one 3 by 3 room, the door in the middle of the front, a window each side. Not thatch (no windows).",
    rooms: [{ at: [0, 0], size: [3, 3], doors: ["s1"], windows: ["e1", "w1"] }],
  },
  longhouse_2x5: {
    about: "Two rooms in a row: a 2 by 3 hall at the back and a 2 by 2 porch room, a door between them and one at the front.",
    rooms: [
      { at: [0, 0], size: [2, 3], windows: ["w1", "e1"] },
      { at: [0, 3], size: [2, 2], doors: ["n0", "s1"] },
    ],
  },
  l_house: {
    about: "An L of one open space: a 3 by 2 main room with a 2 by 2 wing off its west end, open between them.",
    rooms: [
      { at: [0, 0], size: [3, 2], doors: ["e1"], windows: ["n1"] },
      { at: [0, 2], size: [2, 2], open: ["n"], windows: ["w1"] },
    ],
  },
  workshop_4x3: {
    about: "A work shed open at the front for crafting stations and dinos: walls on three sides, roofed. Not thatch (pillars).",
    rooms: [{ at: [0, 0], size: [4, 3], open: ["s"] }],
    pillars: [{ at: [1, 3] }, { at: [3, 3] }],
  },
  house_3x3_two_storey: {
    about: "A 3 by 3 house of two storeys: stairs in the north-east corner, the door at the front, windows upstairs. Not thatch.",
    rooms: [{ at: [0, 0], size: [3, 3], height: 2, doors: ["s1"], windows: ["1:s0", "1:s2", "1:e1", "1:w1"] }],
    stairs: [{ at: [2, 0], up: "w" }],
  },
  tower_2x2: {
    about: "A lookout: 2 by 2, three storeys, stairs up each, open-topped. Not thatch.",
    rooms: [
      { at: [0, 0], size: [2, 2], height: 2, doors: ["s0"], windows: ["1:n0", "1:e1", "1:s1", "1:w0"] },
      { at: [0, 0], size: [2, 2], level: 2, roofless: true, windows: ["n0", "n1", "e0", "e1", "s0", "s1", "w0", "w1"] },
    ],
    stairs: [{ at: [1, 0], level: 0, up: "w" }, { at: [0, 1], level: 1, up: "e" }],
  },
  walled_yard: {
    about: "A 5 by 5 walled yard with a 3 by 2 house against its back wall: a gate in the front wall, the house door into the yard.",
    rooms: [
      { at: [0, 0], size: [5, 5], roofless: true, doors: ["s2"] },
      { at: [1, 0], size: [3, 2], doors: ["s1"], windows: ["e0", "w0"] },
    ],
  },
};
