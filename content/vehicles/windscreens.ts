// Front glass edges in model space, measured at the inside of the body seals.
type Edge = readonly [y: number, z: number, halfWidth: number];
type Pane = readonly [sill: Edge, header: Edge];
export const FRONT: Readonly<Record<string, Pane>> = {
  "core:compact": [
    [0.95, 0.72, 0.72],
    [1.445, 0.25, 0.67],
  ],
  "core:fastback": [
    [0.9, 0.765, 0.69],
    [1.449, 0.186, 0.6],
  ],
  "core:patrol_sedan": [
    [1.007, 1.069, 0.85],
    [1.447, 0.425, 0.69],
  ],
  "core:patrol_jeep": [
    [1.32, 0.95, 0.84],
    [1.866, 0.578, 0.774],
  ],
  "core:veloce": [
    [0.775, 1.025, 0.795],
    [1.27, 0.085, 0.605],
  ],
  "core:berlinetta": [
    [0.775, 0.892, 0.8],
    [1.27, 0.114, 0.608],
  ],
  "core:zephyr": [
    [0.785, 0.99, 0.795],
    [1.035, 0.255, 0.645],
  ],
  "core:panel_van": [
    [1.34, 1.78, 0.93],
    [2.15, 0.83, 0.84],
  ],
  "core:caravan": [
    [1.04, 1.7, 0.83],
    [1.74, 0.58, 0.76],
  ],
  "core:taxi": [
    [0.95, 0.89, 0.73],
    [1.39, 0.26, 0.64],
  ],
  "core:muscle_car": [
    [0.9, 0.5, 0.76],
    [1.35, -0.02, 0.61],
  ],
  "core:monster_truck": [
    [1.88, 0.23, 0.73],
    [2.4, -0.03, 0.69],
  ],
  "core:bus": [
    [1.775, 3.61, 1.16],
    [2.646, 3.61, 1.16],
  ],
  "core:semi": [
    [1.995, 2.04, 1.02],
    [2.906, 2.04, 1.02],
  ],
  "core:tanker": [
    [2.21, 3.15, 1.02],
    [2.95, 3.055, 1.02],
  ],
};
