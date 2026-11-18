import type { MarineModel, MarinePoint } from "./marine-model.ts";

function hullBox(at: MarinePoint, half: MarinePoint) {
  return { at, half };
}

/** Original power catamarans. X measures port of centre and each drive sits behind its own keel. */
export const POWER_CATS = [
  {
    id: "core:manta", label: "Manta Sport Catamaran", family: "catamaran",
    length: 10.6, beam: 4.15, height: 3.68, draft: .60, beltline: 1.73, sponsonX: 1.35,
    seats: [[-.63, 1.85, .12], [.63, 1.85, .12], [-.73, 1.85, -2.76], [.73, 1.85, -2.76]],
    helm: [-.63, 2.21, .44], grip: .18, camera: [-.63, 2.61, .17],
    propeller: [1.35, .15, -5.16], secondPropeller: [-1.35, .15, -5.16],
    outboard: [1.35, .94, -4.53], secondOutboard: [-1.35, .94, -4.53],
    boarding: { water: [.16, .60, -5.03], ladder: [.16, 1.06, -4.59], deck: [.16, 1.34, -3.94] },
    boxes: [
      ...[-1.35, 1.35].flatMap(x => [
        hullBox([x, .78, -1.32], [.67, .78, 3.12]), hullBox([x, .92, 2.7], [.52, .83, .9]),
        hullBox([x, 1.17, 4.16], [.29, .77, .56]), hullBox([x, 1.45, 5.01], [.105, .50, .29]),
      ]),
      hullBox([0, 1.19, -.30], [1.35, .15, 4.15]),
      hullBox([0, 1.83, .92], [1.20, .49, .27]), hullBox([0, 3.58, -.10], [1.29, .08, 1.55]),
    ], paint: 40, trim: [74, 100],
  },
  {
    id: "core:lagoon", label: "Lagoon Power Catamaran", family: "catamaran",
    length: 17.03, beam: 7.54, height: 7.02, draft: .99, beltline: 2.60, sponsonX: 2.60,
    seats: [[-1.04, 5.02, .60], [-.20, 5.02, .60], [1.10, 5.02, -1.96], [1.94, 5.02, -1.96],
      [-1.72, 2.77, 5.18], [1.72, 2.77, 5.18], [-.65, 2.77, -6.07], [.65, 2.77, -6.07]],
    helm: [-1.04, 5.38, .92], grip: .19, camera: [-1.04, 5.78, .65],
    propeller: [2.60, .32, -6.96], secondPropeller: [-2.60, .32, -6.96],
    boarding: { water: [2.75, .99, -8.91], ladder: [2.75, 1.16, -8.49], deck: [2.75, 2.25, -6.94] },
    boxes: [
      ...[-2.6, 2.6].flatMap(x => [
        hullBox([x, 1.04, -7.60], [.91, .22, .89]), hullBox([x, 1.50, -6.46], [1.06, .76, .25]),
        hullBox([x, 1.33, -5.94], [1.07, .90, .27]), hullBox([x, 1.19, -1.58], [1.10, 1.12, 4.09]),
        hullBox([x, 1.32, 4.03], [.89, 1.19, 1.52]), hullBox([x, 1.55, 6.38], [.57, 1.17, .83]),
        hullBox([x, 1.87, 7.85], [.23, .96, .64]),
      ]),
      hullBox([0, 2, -.30], [2.6, .25, 6.60]), hullBox([0, 3.29, -.56], [2.92, 1.04, 4.01]),
      hullBox([0, 4.41, -1.20], [3.19, .11, 4.63]), hullBox([0, 6.67, -1.04], [2.65, .09, 3.01]),
    ], paint: 91, trim: [41, 225],
  },
] as const satisfies readonly MarineModel[];
