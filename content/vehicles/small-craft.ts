import type { MarineModel } from "./marine-model.ts";

/** Original craft in the game's keel frame. The sculptor reads these same measurements to place seats and moving joints. */
export const SMALL_CRAFT = [
  {
    id: "core:needle", label: "Needle", family: "offshore", length: 10, beam: 2.2, height: 1.64,
    draft: .43, beltline: .98, paint: 20,
    seats: [[0, .90, -.66], [0, .91, -1.81]], helm: [0, 1.26, -.357], grip: .18, camera: [0, 1.66, -.61],
    outboard: [0, .51, -4.50], propeller: [0, .10, -4.90],
    boarding: { water: [.91, .43, -5.32], ladder: [.81, .74, -4.52], deck: [.74, 1.00, -3.96] },
    boxes: [
      { at: [0, .40, -2.12], half: [.97, .36, 2.30] }, { at: [0, .56, .98], half: [.86, .46, .80] },
      { at: [0, .72, 2.43], half: [.61, .37, .65] }, { at: [0, .82, 3.61], half: [.35, .25, .53] },
      { at: [0, .93, 4.53], half: [.12, .16, .39] },
    ],
  },
  {
    id: "core:thunderbolt", label: "Thunderbolt", family: "offshore", length: 13, beam: 2.9, height: 2.10,
    draft: .58, beltline: 1.40, paint: 29,
    seats: [[.64, 1.26, -.30], [-.64, 1.26, -.30], [.76, 1.21, -2.26], [0, 1.21, -2.26], [-.76, 1.21, -2.26]],
    helm: [.64, 1.62, .007], grip: .19, camera: [.64, 2.02, -.25],
    outboard: [.57, .64, -5.95], propeller: [.57, .15, -6.38],
    secondOutboard: [-.57, .64, -5.95], secondPropeller: [-.57, .15, -6.38],
    boarding: { water: [1.31, .58, -6.83], ladder: [1.18, .77, -6.31], deck: [1.13, .89, -5.89] },
    boxes: [
      { at: [0, .53, -2.95], half: [1.27, .48, 2.85] }, { at: [0, .65, .72], half: [1.26, .52, .82] },
      { at: [0, .87, 2.55], half: [.99, .48, 1.01] }, { at: [0, 1.0, 4.33], half: [.66, .37, .77] },
      { at: [0, 1.11, 5.73], half: [.24, .23, .63] },
    ],
  },
  {
    id: "core:jon_boat", label: "Jon Boat", family: "jon", length: 4.40, beam: 1.62, height: 1.15,
    draft: .20, beltline: .58, paint: 136,
    seats: [[.33, .52, -.65], [-.28, .51, .52]], helm: [.33, .88, -.328], grip: .155, camera: [.33, 1.28, -.60],
    outboard: [0, .50, -1.75], propeller: [0, -.09, -2.105],
    boarding: { water: [.76, .20, -2.43], ladder: [.63, .45, -1.84], deck: [.54, .25, -1.37] },
    boxes: [
      { at: [0, .115, -.31], half: [.70, .11, 1.37] }, { at: [0, .25, 1.60], half: [.57, .18, .54] },
      { at: [.76, .32, -.30], half: [.04, .25, 1.30] }, { at: [-.76, .32, -.30], half: [.04, .25, 1.30] },
    ],
  },
  {
    id: "core:riptide", label: "Riptide", family: "pwc", length: 3.30, beam: 1.22, height: 1.17,
    draft: .22, beltline: .43, paint: 52,
    seats: [[0, .76, -.17], [0, .87, -.79]], helm: [0, 1.13, .05], helmAxis: [0, 1, 0],
    grip: .315, camera: [0, 1.52, -.12], outboard: [0, .22, -1.40], propeller: [0, .19, -1.58], jetIntake: [0, .035, -.83],
    boarding: { water: [0, .22, -2.06], ladder: [.36, .33, -1.61], deck: [.28, .44, -1.36] },
    boxes: [
      { at: [0, .23, -.51], half: [.51, .19, 1.10] }, { at: [0, .31, .86], half: [.45, .23, .27] },
      { at: [0, .43, 1.37], half: [.26, .15, .24] }, { at: [0, .64, .42], half: [.25, .25, .37] },
    ],
  },
] as const satisfies readonly MarineModel[];
