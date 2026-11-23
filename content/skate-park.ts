// Pieces to skate, made in the hand from wood and stone: a kicker that throws a rider, a rail and a ledge to grind. Each is
// set down on the ground or a floor as a storage box is. The rail and ledge are ground along the tops of their boxes
// (shared/world/grind.ts). Their ids sort after every shipped kind, so no index in a save or a map moves.

import { crafting } from "./craft.ts";
import { shapeHalf, type Def, type ShapeBox, type ShapeDef, type StructureDef } from "../shared/content/defs.ts";
import { slopeShape, wedge } from "../shared/content/slopes.ts";
import { PAVING } from "../shared/world/vehicle-surface.ts";

export const skatePiece = (name: string): string => `core:zzzzzzskate_${name}`;
const box = (x: number, y: number, z: number, hx: number, hy: number, hz: number): ShapeBox => ({ at: [x, y, z], half: [hx, hy, hz] });

interface Piece {
  readonly name: string;
  readonly label: string;
  readonly shape: ShapeDef;
  readonly hp: number;
  readonly weight: number;
  readonly needs: readonly (readonly [item: string, count: number])[];
}

const PIECES: readonly Piece[] = [
  // 0.5 m up over 1.6 m, about 17 degrees: rolled up at speed it throws a rider about a metre higher.
  { name: "kicker", label: "Skate kicker", shape: slopeShape(skatePiece("kicker_shape"), "thing", [wedge(1.2, 1.6, .5)]), hp: 1200, weight: 6,
    needs: [["wood", 20], ["fiber", 10]] },
  // A 3 m bar 45 cm up on two posts: one edge along its middle.
  { name: "rail", label: "Grind rail", hp: 1500, weight: 5, needs: [["wood", 10], ["stone", 12], ["fiber", 6]],
    shape: { type: "shape", id: skatePiece("rail_shape"), role: "thing", boxes: [box(0, .2, 0, 1.5, .025, .025), box(-1.35, -.025, 0, .03, .2, .03), box(1.35, -.025, 0, .03, .2, .03)] } },
  // A 2.4 m box 40 cm high: an edge along each long side.
  { name: "ledge", label: "Skate ledge", hp: 2000, weight: 8, needs: [["wood", 25], ["stone", 20]],
    shape: { type: "shape", id: skatePiece("ledge_shape"), role: "thing", boxes: [box(0, 0, 0, 1.2, .2, .3)] } },
];

function piece(p: Piece): Def[] {
  const item = skatePiece(`${p.name}_item`);
  const structure: StructureDef = {
    type: "structure", class: "piece", id: skatePiece(p.name), mesh: "shape", shape: p.shape.id, half: shapeHalf(p.shape.boxes, p.shape.hulls),
    color: 3, hp: p.hp, material: "core:mat_wood", decayDays: 16, vehicleSurface: PAVING,
  };
  return [
    p.shape,
    structure,
    { type: "item", class: "structure", id: item, stack: 5, weight: p.weight, label: p.label.toLowerCase(), color: 3, places: [structure.id] },
    ...crafting(item, { needs: p.needs.map(([n, count]) => ({ item: `core:${n}`, count })), seconds: 5, xp: 2 }),
    { type: "engram", id: skatePiece(`${p.name}_engram`), label: p.label, level: 4, cost: 2, item },
  ];
}

export const SKATE_PARK: readonly Def[] = PIECES.flatMap(piece);
