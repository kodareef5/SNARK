// The glass panes a vehicle's own mesh holds, where its pictures hold them: the cells of a material's picture, each
// [u0, v0, u1, v1] in its texture coordinates (u across the picture, v down it). Most road vehicles have open windows,
// or a pane's middle cut out and the front glass drawn as a card (windscreens.ts); these are the panes left solid: the
// fastback's back light and rear quarters, the vans' fixed side and rear glass, the jeep's cargo windows, and the
// abandoned compact's front and rear glass, whose cells are the clear middles of the driven compact's panes on the
// layout the two share. client/core/render/vehicle-glass.ts draws them seen through.
export type Cell = readonly [u0: number, v0: number, u1: number, v1: number];
export interface GlassCells {
  readonly materials: readonly string[];
  readonly cells: readonly Cell[];
  /**
   * Where the front glass is its windscreen's card: the cell's faces turned forward (the windscreen's frit and edge,
   * whose middle is open) are left solid as they were.
   */
  readonly card?: boolean;
}
export const GLASS: readonly GlassCells[] = [
  { materials: ["core:road_van/fittings"], cells: [[0.25, 0.5, 0.5, 0.75]], card: true },
  { materials: ["core:fastback/detail"], cells: [[0.125, 0.25, 0.25, 0.375]], card: true },
  { materials: ["core:patrol_jeep/patrol"], cells: [[0.25, 0.125, 0.375, 0.25]], card: true },
  { materials: ["core:compact_abandoned/cabin"], cells: [[0.3, 0.731, 0.398, 0.797], [0.22, 0.809, 0.335, 0.851]] },
];
